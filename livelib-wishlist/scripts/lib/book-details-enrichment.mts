import { execFile, type ExecFileOptions } from 'node:child_process';

import {
  audiobookEntriesMissingDurationForBook,
  averageAudiobookEntryDurationMinutesForBook,
  extractAudiobookNarrator,
  extractAudiobookDurationMinutes,
  firstAudiobookEntryMissingNarratorForBook,
  firstAudiobookUrlForBook,
  hasAudiobookEntriesMissingDuration,
  hasAudiobookEntriesMissingNarrator,
  hasRecordedAudiobookEntryDuration,
  hasRecordedAudiobookDuration,
  withAverageAudiobookDuration,
} from './audiobook-duration.mjs';
import {
  type AudiobookEntryInput,
  audiobookEntriesForBook,
  isRutrackerUrl,
  mergeAudiobookUrls,
} from './book-url-fields.mjs';
import {
  extractBookPageDetails,
  hasRecordedBookPageDescription,
  hasRecordedBookPageGenre,
  hasRecordedBookPageImage,
  needsBookPageDetails,
} from './livelib-book-page.mjs';
import { extractRutrackerAudiobookTitle } from './rutracker-books.mjs';

type BookDetailsBook = Record<string, unknown> & {
  url?: string | null;
  audiobooks_urls?: unknown;
  yandex_books_urls?: unknown;
  litres_urls?: unknown;
  rutracker_urls?: unknown;
  audiobook_duration_minutes?: unknown;
};

type FetchedPage = {
  url?: string | null;
  html?: string | null;
} | null | undefined;

type PageFetcher = (options: {
  url: string;
  book: BookDetailsBook;
}) => Promise<FetchedPage> | FetchedPage;

type FetchErrorHandler = (details: {
  book: BookDetailsBook;
  url: string;
  error: unknown;
}) => void;

type SleepFn = (ms: number) => Promise<unknown>;
type SleepOptions = SleepFn | Partial<Record<'audiobook' | 'bookPage', SleepFn>>;

type EnrichBookWithMissingDetailsOptions = {
  fetchAudiobookPage?: PageFetcher;
  fetchBookPage?: PageFetcher;
  onAudiobookFetchError?: FetchErrorHandler;
  onBookPageFetchError?: FetchErrorHandler;
  pageDelayMs?: number;
  sleep?: SleepOptions;
};

type EnrichBooksWithMissingDetailsOptions = EnrichBookWithMissingDetailsOptions & {
  onBookProcessed?: (details: { book: BookDetailsBook }) => void;
};

type BookDetailsStats = {
  skippedAudiobookDuration: number;
  enrichedAudiobookDuration: number;
  skippedAudiobookTitle: number;
  enrichedAudiobookTitle: number;
  skippedAudiobookNarrator: number;
  enrichedAudiobookNarrator: number;
  skippedBookPageDetails: number;
  enrichedBookDescriptions: number;
  enrichedBookImages: number;
  enrichedBookGenres: number;
};

type MissingBookDetailsState = {
  hasDescription: boolean;
  hasImage: boolean;
  hasGenre: boolean;
  needsBookPageDetails: boolean;
};

type BookDetailsWithDescription = {
  description: string | null;
  image: string | null;
  genre: string | null;
};

type PartialEnrichedAudiobookEntry = AudiobookEntryInput & {
  url: string;
  title?: string;
  duration?: number;
  narrator?: string;
};

type ExecErrorWithStderr = Error & {
  stderr?: string;
};

const RUTRACKER_TOPIC_PATH = '/forum/viewtopic.php';
const RUTRACKER_CURL_TIMEOUT_MS = 30_000;
const RUTRACKER_CURL_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const YANDEX_BOOKS_AUDIOBOOK_PATH_RE = /^\/(?:[a-z]{2}-[a-z]{2}\/)?audiobooks?\/[^/]+\/?$/iu;
const LIVELIB_BOOK_PATH_RE = /^\/book\/[^/]+\/?$/u;
const LITRES_AUDIOBOOK_PATH_RE = /^\/audiobook\/[^/]+(?:\/[^/]+)*\/?$/u;

function createInitialBookDetailsStats(): BookDetailsStats {
  return {
    skippedAudiobookDuration: 0,
    enrichedAudiobookDuration: 0,
    skippedAudiobookTitle: 0,
    enrichedAudiobookTitle: 0,
    skippedAudiobookNarrator: 0,
    enrichedAudiobookNarrator: 0,
    skippedBookPageDetails: 0,
    enrichedBookDescriptions: 0,
    enrichedBookImages: 0,
    enrichedBookGenres: 0,
  };
}

function getMissingBookDetailsState(book: BookDetailsBook): MissingBookDetailsState {
  return {
    hasDescription: hasRecordedBookPageDescription(book),
    hasImage: hasRecordedBookPageImage(book),
    hasGenre: hasRecordedBookPageGenre(book),
    needsBookPageDetails: needsBookPageDetails(book),
  };
}

function addBookDetailsStats(target: BookDetailsStats, source: BookDetailsStats): void {
  for (const key of Object.keys(target) as (keyof BookDetailsStats)[]) {
    target[key] += source[key] ?? 0;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getSleepFn(sleep: SleepOptions, key: 'audiobook' | 'bookPage'): SleepFn {
  if (typeof sleep === 'function') {
    return sleep;
  }

  if (typeof sleep?.[key] === 'function') {
    return sleep[key];
  }

  return defaultSleep;
}

function isRutrackerTopicUrl(rawUrl: AudiobookEntryInput): boolean {
  if (!isRutrackerUrl(rawUrl)) {
    return false;
  }

  try {
    const url = new URL(String(rawUrl));
    return url.pathname === RUTRACKER_TOPIC_PATH && url.searchParams.has('t');
  } catch {
    return false;
  }
}

function isYandexBooksAudiobookUrl(rawUrl: unknown): boolean {
  try {
    const url = new URL(String(rawUrl));
    return (
      url.hostname.toLowerCase().startsWith('books.yandex.')
      && YANDEX_BOOKS_AUDIOBOOK_PATH_RE.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isLiveLibBookUrl(rawUrl: unknown): boolean {
  try {
    const url = new URL(String(rawUrl));
    const hostname = url.hostname.toLowerCase();
    return (
      (hostname === 'www.livelib.ru' || hostname === 'livelib.ru')
      && LIVELIB_BOOK_PATH_RE.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isLitresAudiobookUrl(rawUrl: unknown): boolean {
  try {
    const url = new URL(String(rawUrl));
    const hostname = url.hostname.toLowerCase();
    return (
      (hostname === 'www.litres.ru' || hostname === 'litres.ru')
      && LITRES_AUDIOBOOK_PATH_RE.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function execFileBuffer(
  command: string,
  args: readonly string[],
  options: ExecFileOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { ...options, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error) {
        const errorWithStderr = error as ExecErrorWithStderr;
        errorWithStderr.stderr = stderr?.toString('utf8') ?? '';
        reject(errorWithStderr);
        return;
      }

      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}

async function fetchRutrackerTopicPageWithCurl(url: string): Promise<{ url: string; html: string }> {
  const htmlBuffer = await execFileBuffer('curl', [
    '-sSL',
    '--max-time',
    String(Math.ceil(RUTRACKER_CURL_TIMEOUT_MS / 1000)),
    url,
  ], {
    timeout: RUTRACKER_CURL_TIMEOUT_MS,
    maxBuffer: RUTRACKER_CURL_MAX_BUFFER_BYTES,
  });

  return {
    url,
    html: new TextDecoder('windows-1251').decode(htmlBuffer),
  };
}

async function fetchUtf8PageWithCurl(url: string): Promise<{ url: string; html: string }> {
  const htmlBuffer = await execFileBuffer('curl', [
    '-sSL',
    '--max-time',
    String(Math.ceil(RUTRACKER_CURL_TIMEOUT_MS / 1000)),
    url,
  ], {
    timeout: RUTRACKER_CURL_TIMEOUT_MS,
    maxBuffer: RUTRACKER_CURL_MAX_BUFFER_BYTES,
  });

  return {
    url,
    html: new TextDecoder('utf-8').decode(htmlBuffer),
  };
}

async function fetchAudiobookPageForDetails({
  url,
  book,
  fetchAudiobookPage,
}: {
  url: string;
  book: BookDetailsBook;
  fetchAudiobookPage?: PageFetcher;
}): Promise<FetchedPage> {
  if (isRutrackerTopicUrl(url)) {
    try {
      return await fetchRutrackerTopicPageWithCurl(url);
    } catch (error) {
      if (typeof fetchAudiobookPage !== 'function') {
        throw error;
      }
    }
  }

  if (isYandexBooksAudiobookUrl(url)) {
    try {
      return await fetchUtf8PageWithCurl(url);
    } catch (error) {
      if (typeof fetchAudiobookPage !== 'function') {
        throw error;
      }
    }
  }

  if (isLitresAudiobookUrl(url)) {
    try {
      return await fetchUtf8PageWithCurl(url);
    } catch (error) {
      if (typeof fetchAudiobookPage !== 'function') {
        throw error;
      }
    }
  }

  if (typeof fetchAudiobookPage !== 'function') {
    return null;
  }

  return fetchAudiobookPage({ url, book });
}

async function fetchBookPageForDetails({
  url,
  book,
  fetchBookPage,
}: {
  url: string;
  book: BookDetailsBook;
  fetchBookPage?: PageFetcher;
}): Promise<FetchedPage> {
  if (isLiveLibBookUrl(url)) {
    try {
      return await fetchUtf8PageWithCurl(url);
    } catch (error) {
      if (typeof fetchBookPage !== 'function') {
        throw error;
      }
    }
  }

  if (typeof fetchBookPage !== 'function') {
    return null;
  }

  return fetchBookPage({ url, book });
}

export async function enrichBookWithMissingDetails(
  book: BookDetailsBook,
  {
    fetchAudiobookPage,
    fetchBookPage,
    onAudiobookFetchError,
    onBookPageFetchError,
    pageDelayMs = 0,
    sleep = defaultSleep,
  }: EnrichBookWithMissingDetailsOptions = {},
): Promise<{
  book: BookDetailsBook;
  stats: BookDetailsStats;
  needs: {
    audiobookDuration: boolean;
    audiobookNarrator: boolean;
    bookPageDetails: boolean;
  };
}> {
  const nextBook: BookDetailsBook = { ...book };
  const stats = createInitialBookDetailsStats();
  const audiobookEntries = audiobookEntriesForBook(nextBook)
    .filter((entry) => (
      isRutrackerTopicUrl(entry.url)
      || isYandexBooksAudiobookUrl(entry.url)
      || isLitresAudiobookUrl(entry.url)
      || typeof fetchAudiobookPage === 'function'
    ));
  const entriesToFetch = audiobookEntries
    .filter((entry) => (
      !hasRecordedAudiobookEntryDuration(entry)
      || !entry.narrator
      || (isRutrackerTopicUrl(entry.url) && !entry.title)
    ));
  const bookDetailsState = getMissingBookDetailsState(nextBook);

  stats.skippedAudiobookDuration += audiobookEntries
    .filter(hasRecordedAudiobookEntryDuration).length;
  stats.skippedAudiobookTitle += audiobookEntries
    .filter((entry) => entry.title).length;
  stats.skippedAudiobookNarrator += audiobookEntries
    .filter((entry) => entry.narrator).length;

  for (const audiobookEntry of entriesToFetch) {
    const fetchUrl = audiobookEntry.url;
    try {
      const page = await fetchAudiobookPageForDetails({
        url: fetchUrl,
        book: nextBook,
        fetchAudiobookPage,
      });
      const html = page?.html ?? '';

      const enrichedEntry: PartialEnrichedAudiobookEntry = { url: fetchUrl };
      if (isRutrackerTopicUrl(fetchUrl) && !audiobookEntry.title) {
        const title = extractRutrackerAudiobookTitle(html);
        if (title) {
          enrichedEntry.title = title;
          stats.enrichedAudiobookTitle += 1;
        }
      }

      if (!hasRecordedAudiobookEntryDuration(audiobookEntry)) {
        const duration = extractAudiobookDurationMinutes(html);
        if (duration !== null) {
          enrichedEntry.duration = duration;
          stats.enrichedAudiobookDuration += 1;
        }
      }

      if (!audiobookEntry.narrator) {
        const narrator = extractAudiobookNarrator(html);
        if (narrator) {
          enrichedEntry.narrator = narrator;
          stats.enrichedAudiobookNarrator += 1;
        }
      }

      if (
        Object.prototype.hasOwnProperty.call(enrichedEntry, 'title')
        || Object.prototype.hasOwnProperty.call(enrichedEntry, 'duration')
        || Object.prototype.hasOwnProperty.call(enrichedEntry, 'narrator')
      ) {
        nextBook.audiobooks_urls = mergeAudiobookUrls(nextBook, [enrichedEntry]);
      }
    } catch (error) {
      if (typeof onAudiobookFetchError === 'function') {
        onAudiobookFetchError({ book: nextBook, url: fetchUrl, error });
      }
    }

    if (pageDelayMs > 0) {
      await getSleepFn(sleep, 'audiobook')(pageDelayMs);
    }
  }

  if (!bookDetailsState.needsBookPageDetails) {
    stats.skippedBookPageDetails += 1;
  } else if (
    typeof nextBook.url === 'string'
    && (typeof fetchBookPage === 'function' || isLiveLibBookUrl(nextBook.url))
  ) {
    let details: BookDetailsWithDescription = { description: null, image: null, genre: null };
    try {
      const page = await fetchBookPageForDetails({
        url: nextBook.url,
        book: nextBook,
        fetchBookPage,
      });
      details = {
        description: null,
        ...extractBookPageDetails(page?.html ?? '', page?.url ?? nextBook.url),
      };
    } catch (error) {
      if (typeof onBookPageFetchError === 'function') {
        onBookPageFetchError({ book: nextBook, url: nextBook.url, error });
      }
    }

    if (!bookDetailsState.hasDescription && details.description) {
      nextBook.description = details.description;
      stats.enrichedBookDescriptions += 1;
    }
    if (!bookDetailsState.hasImage && details.image) {
      nextBook.image = details.image;
      stats.enrichedBookImages += 1;
    }
    if (!bookDetailsState.hasGenre) {
      nextBook.genre = details.genre;
      if (details.genre !== null) {
        stats.enrichedBookGenres += 1;
      }
    }

    if (pageDelayMs > 0) {
      await getSleepFn(sleep, 'bookPage')(pageDelayMs);
    }
  }

  const bookWithAverageAudiobookDuration = withAverageAudiobookDuration(nextBook) as BookDetailsBook;

  return {
    book: bookWithAverageAudiobookDuration,
    stats,
    needs: {
      audiobookDuration: hasAudiobookEntriesMissingDuration(bookWithAverageAudiobookDuration),
      audiobookNarrator: hasAudiobookEntriesMissingNarrator(bookWithAverageAudiobookDuration),
      bookPageDetails: needsBookPageDetails(bookWithAverageAudiobookDuration),
    },
  };
}

export async function enrichBooksWithMissingDetails(
  books: readonly BookDetailsBook[],
  options: EnrichBooksWithMissingDetailsOptions = {}
): Promise<{
  books: BookDetailsBook[];
  stats: BookDetailsStats;
}> {
  if (!Array.isArray(books)) {
    throw new Error('Books must be an array');
  }

  const { onBookProcessed, ...bookOptions } = options;
  const enrichedBooks: BookDetailsBook[] = [];
  const stats = createInitialBookDetailsStats();

  for (const book of books) {
    const result = await enrichBookWithMissingDetails(book, bookOptions);
    enrichedBooks.push(result.book);
    addBookDetailsStats(stats, result.stats);

    if (typeof onBookProcessed === 'function') {
      onBookProcessed({ book: result.book });
    }
  }

  return {
    books: enrichedBooks,
    stats,
  };
}

export {
  extractAudiobookNarrator,
  extractAudiobookDurationMinutes,
  extractBookPageDetails,
  audiobookEntriesMissingDurationForBook,
  averageAudiobookEntryDurationMinutesForBook,
  firstAudiobookEntryMissingNarratorForBook,
  firstAudiobookUrlForBook,
  hasAudiobookEntriesMissingDuration,
  hasAudiobookEntriesMissingNarrator,
  hasRecordedAudiobookEntryDuration,
  hasRecordedBookPageDescription,
  hasRecordedBookPageGenre,
  hasRecordedBookPageImage,
  hasRecordedAudiobookDuration,
  withAverageAudiobookDuration,
  needsBookPageDetails,
};
