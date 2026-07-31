import { cleanText, parseHttpUrl } from '../core/text-match.mjs';

export type AudiobookEntryInput = string | {
  url?: unknown;
  title?: unknown;
  narrator?: unknown;
  duration?: unknown;
} | null | undefined;

export type AudiobookEntry = {
  url: string;
  title: string | null;
  narrator: string | null;
  duration: number | null;
};

type BookWithUrlFields = {
  yandex_books_urls?: unknown;
  litres_urls?: unknown;
  rutracker_urls?: unknown;
  audiobooks_urls?: unknown;
} | null | undefined;

type SplitAudiobookUrlsResult = {
  regularUrls: string[];
  audiobookUrls: AudiobookEntry[];
};

export function audiobookEntryUrl(entry: AudiobookEntryInput): string | null {
  if (typeof entry === 'string') {
    return entry;
  }

  return typeof entry?.url === 'string' ? entry.url : null;
}

export function normalizeAudiobookEntry(entry: AudiobookEntryInput): AudiobookEntry | null {
  const url = cleanText(audiobookEntryUrl(entry));
  if (!url) {
    return null;
  }

  const fields = typeof entry === 'object' && entry !== null ? entry : {};
  const title = cleanText(fields.title);
  const narrator = cleanText(fields.narrator);
  const duration = typeof fields.duration === 'number' && Number.isFinite(fields.duration)
    ? fields.duration
    : null;

  return {
    url,
    title: title || null,
    narrator: narrator || null,
    duration,
  };
}

export function isAudiobookUrl(rawUrl: AudiobookEntryInput): boolean {
  const url = audiobookEntryUrl(rawUrl);
  return typeof url === 'string' && url.toLowerCase().includes('audiobook');
}

export function isRutrackerUrl(rawUrl: AudiobookEntryInput): boolean {
  const url = audiobookEntryUrl(rawUrl);
  if (typeof url !== 'string') {
    return false;
  }

  return parseHttpUrl(url)?.hostname.toLowerCase().endsWith('rutracker.org')
    ?? url.toLowerCase().includes('rutracker.org/');
}

export function uniqueUrls(urls: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    if (typeof url !== 'string' || seen.has(url)) {
      continue;
    }
    seen.add(url);
    result.push(url);
  }

  return result;
}

export function uniqueAudiobookEntries(entries: readonly AudiobookEntryInput[]): AudiobookEntry[] {
  const byUrl = new Map<string, AudiobookEntry>();

  for (const entry of entries) {
    const normalizedEntry = normalizeAudiobookEntry(entry);
    if (!normalizedEntry) {
      continue;
    }

    const existingEntry = byUrl.get(normalizedEntry.url);
    if (!existingEntry) {
      byUrl.set(normalizedEntry.url, normalizedEntry);
      continue;
    }

    byUrl.set(normalizedEntry.url, {
      url: existingEntry.url,
      title: existingEntry.title || normalizedEntry.title || null,
      narrator: existingEntry.narrator || normalizedEntry.narrator || null,
      duration: Number.isFinite(existingEntry.duration)
        ? existingEntry.duration
        : normalizedEntry.duration,
    });
  }

  return [...byUrl.values()];
}

export function splitAudiobookUrls(urls: unknown): SplitAudiobookUrlsResult {
  const regularUrls: unknown[] = [];
  const audiobookUrls: AudiobookEntryInput[] = [];

  for (const url of Array.isArray(urls) ? urls : []) {
    if (isAudiobookUrl(url) || isRutrackerUrl(url)) {
      audiobookUrls.push(url);
    } else {
      regularUrls.push(url);
    }
  }

  return {
    regularUrls: uniqueUrls(regularUrls),
    audiobookUrls: uniqueAudiobookEntries(audiobookUrls),
  };
}

export function mergeAudiobookUrls(
  book: BookWithUrlFields,
  urls: readonly AudiobookEntryInput[]
): AudiobookEntry[] {
  return uniqueAudiobookEntries([
    ...(Array.isArray(book?.audiobooks_urls) ? book.audiobooks_urls : []),
    ...urls,
  ]);
}

export function audiobookEntriesForBook(book: BookWithUrlFields): AudiobookEntry[] {
  return uniqueAudiobookEntries([
    ...(Array.isArray(book?.audiobooks_urls) ? book.audiobooks_urls : []),
    ...splitAudiobookUrls(book?.yandex_books_urls).audiobookUrls,
    ...splitAudiobookUrls(book?.litres_urls).audiobookUrls,
    ...(Array.isArray(book?.rutracker_urls) ? book.rutracker_urls : []),
  ]);
}

export function audiobookUrlsForBook(book: BookWithUrlFields): string[] {
  return audiobookEntriesForBook(book).map((entry) => entry.url);
}

export function audiobookEntriesMissingNarratorForBook(book: BookWithUrlFields): AudiobookEntry[] {
  return audiobookEntriesForBook(book).filter((entry) => !entry.narrator);
}

export function normalizeBookAudiobookUrls<Book>(book: Book): Book | (Book & {
  audiobooks_urls: AudiobookEntry[];
}) {
  if (!book || typeof book !== 'object') {
    return book;
  }

  const bookWithUrls = book as Book & { audiobooks_urls?: unknown };
  if (!Array.isArray(bookWithUrls.audiobooks_urls)) {
    return book;
  }

  return {
    ...book,
    audiobooks_urls: uniqueAudiobookEntries(bookWithUrls.audiobooks_urls),
  };
}
