import { load, type CheerioAPI } from 'cheerio';

import { defaultSleep } from '../core/async-utils.mjs';
import { extractLabeledPageTextValue } from '../audiobooks/audiobook-page-fields.mjs';
import {
  cleanText,
  extractNormalizedHrefUrls,
  hasTokenOverlap,
  isHostnameIn,
  normalizeForMatch,
  parseHttpUrl,
  stripParentheticalText,
  stripTrailingSlash,
} from '../core/text-match.mjs';
import { buildBookSearchQuery } from '../books/book-search-query.mjs';
import { mergeAudiobookUrls, splitAudiobookUrls } from '../books/book-url-fields.mjs';
import { LIVELIB_SOURCE_BOOK, type LiveLibBook } from '../livelib/livelib.mjs';

type BookLike = Record<string | symbol, unknown> & {
  title?: unknown;
  authors?: unknown;
  url?: string;
  yandex_books_urls?: unknown;
  audiobooks_urls?: unknown;
  [LIVELIB_SOURCE_BOOK]?: LiveLibBook;
};

type YandexBooksSearchResult = {
  title: string;
  authors: string[];
  url: string;
};

type FilterOptions = {
  maxResults?: number;
};

type SearchPage = {
  url: string;
  html: string;
};

type SearchPageFetcher = (options: {
  query: string;
  profileDir?: unknown;
  playwright?: unknown;
}) => Promise<SearchPage> | SearchPage;

type EnrichBooksWithYandexBooksUrlsOptions = {
  existingBooks?: readonly BookLike[];
  fetchSearchPage?: SearchPageFetcher;
  profileDir?: unknown;
  playwright?: unknown;
  maxResults?: number;
  delayMs?: number;
  onSearchError?: (details: {
    book: BookLike;
    query: string;
    error: unknown;
  }) => void;
  sleep?: (ms: number) => Promise<unknown>;
};

type CheerioSelection = ReturnType<CheerioAPI>;
type CheerioArgument = Parameters<CheerioAPI>[0];

const YANDEX_BOOKS_ITEM_PATH_RE = /^\/(?:books|audiobooks)\/[^/]+$/;
const YANDEX_BOOKS_ET_AL_RE = /(?:^|[\s,;])(?:и\s+)?др\.?$/iu;
const YANDEX_BOOKS_NARRATOR_LABELS = ['Рассказчик', 'Рассказчики'];
const YANDEX_BOOKS_DURATION_LABEL = 'Длительность';
const YANDEX_BOOKS_DURATION_SECONDS_RE = /(?:"|\\")duration(?:"|\\")\s*:\s*(\d+)/u;
const YANDEX_BOOKS_TITLE_MATCH_STOP_RE = /[.:?]/u;

export function extractYandexBooksAudiobookNarrator(html: unknown): string | null {
  return extractLabeledPageTextValue(html, YANDEX_BOOKS_NARRATOR_LABELS, {
    stopLabels: [...YANDEX_BOOKS_NARRATOR_LABELS, YANDEX_BOOKS_DURATION_LABEL],
  });
}

export function extractYandexBooksAudiobookDurationMinutes(html: unknown): number | null {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  const durationMatch = html.match(YANDEX_BOOKS_DURATION_SECONDS_RE);
  if (durationMatch) {
    const seconds = Number.parseInt(durationMatch[1] ?? '', 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.floor(seconds / 60);
    }
  }

  return parseYandexBooksDurationMinutes(
    extractLabeledPageTextValue(html, [YANDEX_BOOKS_DURATION_LABEL]),
  );
}

function parseYandexBooksDurationMinutes(value: unknown): number | null {
  const text = cleanText(value).toLowerCase();
  if (!text) {
    return null;
  }

  const hoursMatch = text.match(/(\d+)\s*(?:ч\.?|час(?:а|ов)?)/u);
  const minutesMatch = text.match(/(\d+)\s*(?:м\.?|мин\.?|минут(?:а|ы)?)/u);
  const hours = hoursMatch ? Number.parseInt(hoursMatch[1] ?? '', 10) : 0;
  const minutes = minutesMatch ? Number.parseInt(minutesMatch[1] ?? '', 10) : 0;
  const totalMinutes = hours * 60 + minutes;

  return totalMinutes > 0 ? totalMinutes : null;
}

export function isSimilarYandexBooksTitle(sourceTitle: unknown, candidateTitle: unknown): boolean {
  const source = normalizeYandexBooksSourceTitleForMatch(sourceTitle);
  const candidate = normalizeForMatch(candidateTitle);

  if (!source || !candidate) {
    return false;
  }

  return (
    source === candidate ||
    candidate.includes(source) ||
    source.includes(candidate) ||
    hasTokenOverlap(source, candidate)
  );
}

function normalizeYandexBooksSourceTitleForMatch(title: unknown): string {
  return normalizeForMatch(
    cleanText(stripParentheticalText(title).split(YANDEX_BOOKS_TITLE_MATCH_STOP_RE, 1)[0]),
  );
}

export function isSimilarYandexBooksAuthor(sourceAuthor: unknown, candidateAuthor: unknown): boolean {
  const source = normalizeForMatch(sourceAuthor);
  const candidate = normalizeForMatch(candidateAuthor);

  if (!source || !candidate) {
    return false;
  }

  return (
    source === candidate ||
    candidate.includes(source) ||
    source.includes(candidate) ||
    isAbbreviatedYandexBooksAuthorMatch(source, candidate) ||
    hasTokenOverlap(source, candidate, 0.66)
  );
}

function isAbbreviatedYandexBooksAuthorMatch(sourceAuthor: string, candidateAuthor: string): boolean {
  return areAuthorNamePartsCompatible(
    splitYandexBooksAuthorName(sourceAuthor),
    splitYandexBooksAuthorName(candidateAuthor),
  ) || areAuthorNamePartsCompatible(
    splitYandexBooksAuthorName(candidateAuthor),
    splitYandexBooksAuthorName(sourceAuthor),
  );
}

function splitYandexBooksAuthorName(author: string): string[] {
  return normalizeForMatch(author).split(' ').filter(Boolean);
}

function areAuthorNamePartsCompatible(
  fullNameParts: readonly string[],
  abbreviatedNameParts: readonly string[]
): boolean {
  if (fullNameParts.length < 2 || abbreviatedNameParts.length < 2) {
    return false;
  }

  const fullLastName = fullNameParts.at(-1);
  const abbreviatedLastName = abbreviatedNameParts.at(-1);
  if (fullLastName !== abbreviatedLastName) {
    return false;
  }

  const fullGivenNames = fullNameParts.slice(0, -1);
  const abbreviatedGivenNames = abbreviatedNameParts.slice(0, -1);
  if (!abbreviatedGivenNames.some((name) => name.length === 1)) {
    return false;
  }

  const firstAbbreviatedName = abbreviatedGivenNames[0] ?? '';
  const firstFullName = fullGivenNames[0] ?? '';
  const firstNameMatches = firstAbbreviatedName.length === 1
    ? firstFullName.startsWith(firstAbbreviatedName)
    : firstAbbreviatedName === firstFullName;

  return firstNameMatches && abbreviatedGivenNames.every((abbreviatedName) => (
    abbreviatedName.length === 1 || fullGivenNames.includes(abbreviatedName)
  ));
}

export function buildYandexBooksSearchQuery(book: BookLike | null | undefined): string {
  return buildBookSearchQuery({
    title: typeof book?.title === 'string' ? book.title : null,
    authors: Array.isArray(book?.authors) ? book.authors : null,
  });
}

export function buildYandexBooksSearchUrl(query: unknown): string {
  const normalizedQuery = cleanText(query);
  if (!normalizedQuery) {
    throw new Error('Yandex Books search query must not be empty');
  }

  return `https://books.yandex.ru/search/all/${encodeURIComponent(normalizedQuery)}`;
}

export function normalizeYandexBooksUrl(
  rawUrl: string | undefined,
  baseUrl = 'https://books.yandex.ru/'
): string | null {
  const parsed = parseHttpUrl(rawUrl, baseUrl);
  if (!parsed || !isHostnameIn(parsed.hostname, ['books.yandex.ru'])) {
    return null;
  }

  const normalizedPath = stripTrailingSlash(parsed.pathname);
  if (!YANDEX_BOOKS_ITEM_PATH_RE.test(normalizedPath)) {
    return null;
  }

  return `https://books.yandex.ru${normalizedPath}`;
}

export function extractYandexBooksUrls(
  html: string,
  baseUrl = 'https://books.yandex.ru/'
): string[] {
  return extractNormalizedHrefUrls(html, baseUrl, normalizeYandexBooksUrl);
}

export function extractYandexBooksSearchResults(
  html: string,
  baseUrl = 'https://books.yandex.ru/'
): YandexBooksSearchResult[] {
  const $ = load(html);
  const results: YandexBooksSearchResult[] = [];
  const seen = new Set<string>();

  const pushResult = ({ title, authors, url }: YandexBooksSearchResult): void => {
    if (!title || !url || seen.has(url)) {
      return;
    }

    seen.add(url);
    results.push({ title, authors, url });
  };

  $('[data-test-id="SNIPPET"]').each((_, element) => {
    const snippet = $(element);
    const contentLink = snippet.find('a[href]').toArray().find((linkElement) => (
      normalizeYandexBooksUrl($(linkElement).attr('href'), baseUrl)
    ));

    if (!contentLink) {
      return;
    }

    const link = $(contentLink);
    const url = normalizeYandexBooksUrl(link.attr('href'), baseUrl);
    if (!url || seen.has(url)) {
      return;
    }

    const title = cleanText(link.text());
    if (!title) {
      return;
    }

    pushResult({
      title,
      authors: extractYandexBooksAuthors($, snippet),
      url,
    });
  });

  $('a[href]').each((_, element) => {
    const link = $(element);
    const url = normalizeYandexBooksUrl(link.attr('href'), baseUrl);
    if (!url || seen.has(url)) {
      return;
    }

    const card = findYandexBooksResultCard($, link, baseUrl);
    const title = extractYandexBooksResultTitle($, link, card, baseUrl);
    pushResult({
      title,
      authors: extractYandexBooksAuthors($, card),
      url,
    });
  });

  return results;
}

function extractYandexBooksResultTitle(
  $: CheerioAPI,
  link: CheerioSelection,
  card: CheerioSelection,
  baseUrl: string
): string {
  const candidates = [
    link.text(),
    link.attr('aria-label'),
    link.attr('title'),
    link.find('img[alt]').first().attr('alt'),
    card.find('img[alt]').first().attr('alt'),
    ...card.find('a[href]').toArray()
      .filter((element) => normalizeYandexBooksUrl($(element).attr('href'), baseUrl))
      .map((element) => $(element).text()),
  ];

  return candidates.map((value) => cleanText(value)).find(Boolean) ?? '';
}

function extractYandexBooksAuthors($: CheerioAPI, container: CheerioSelection): string[] {
  const explicitAuthors = container.find('[data-test-id="SNIPPET_AUTHORS"]')
    .toArray()
    .filter((author) => !isHiddenYandexBooksAuthor($, author))
    .map((author) => cleanYandexBooksAuthorName($(author).text()))
    .filter(Boolean);
  const authors = explicitAuthors.length > 0
    ? explicitAuthors
    : container.find('a[href*="/authors/"]')
      .toArray()
      .filter((author) => !isHiddenYandexBooksAuthor($, author))
      .map((author) => cleanYandexBooksAuthorName($(author).text()))
      .filter(Boolean);

  return authors.filter((author, index) => authors.indexOf(author) === index);
}

function isHiddenYandexBooksAuthor($: CheerioAPI, author: CheerioArgument): boolean {
  const classNames = ($(author).attr('class') ?? '').split(/\s+/u);
  return classNames.some((className) => className.startsWith('SnippetAuthorsOneLine_hide__'));
}

function cleanYandexBooksAuthorName(author: unknown): string {
  return cleanText(author).replace(YANDEX_BOOKS_ET_AL_RE, '').trim();
}

function findYandexBooksResultCard(
  $: CheerioAPI,
  link: CheerioSelection,
  baseUrl: string
): CheerioSelection {
  let card = link.parent();

  for (const element of link.parents().toArray()) {
    const candidate = $(element);
    const contentLinks = candidate.find('a[href]').toArray().filter((linkElement) => (
      normalizeYandexBooksUrl($(linkElement).attr('href'), baseUrl)
    ));
    const textLength = cleanText(candidate.text()).length;

    if (contentLinks.length > 1 || textLength > 600) {
      break;
    }

    card = candidate;
  }

  return card;
}

export function isYandexBooksResultSimilarToBook(
  result: YandexBooksSearchResult | null | undefined,
  book: BookLike | null | undefined
): boolean {
  return (
    isSimilarYandexBooksTitle(book?.title, result?.title)
    && hasSimilarYandexBooksAuthor(book?.authors, result?.authors)
  );
}

export function filterYandexBooksResultsForBook<Result extends YandexBooksSearchResult>(
  results: readonly Result[],
  book: BookLike | null | undefined,
  { maxResults = Infinity }: FilterOptions = {}
): Result[] {
  const matched: Result[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (matched.length >= maxResults) {
      break;
    }

    if (!result?.url || seen.has(result.url)) {
      continue;
    }

    if (isYandexBooksResultSimilarToBook(result, book)) {
      seen.add(result.url);
      matched.push(result);
    }
  }

  return matched;
}

function hasSimilarYandexBooksAuthor(sourceAuthors: unknown, candidateAuthors: unknown): boolean {
  const sources = Array.isArray(sourceAuthors) ? sourceAuthors : [];
  const candidates = Array.isArray(candidateAuthors) ? candidateAuthors : [];

  return sources.some((sourceAuthor) => (
    candidates.some((candidateAuthor) => (
      isSimilarYandexBooksAuthor(sourceAuthor, candidateAuthor)
    ))
  ));
}

export function extractMatchingYandexBooksUrls(
  html: string,
  book: BookLike | null | undefined,
  baseUrl = 'https://books.yandex.ru/',
  options: FilterOptions = {},
): string[] {
  const results = extractYandexBooksSearchResults(html, baseUrl);
  return filterYandexBooksResultsForBook(
    results,
    book,
    options,
  ).map((result) => result.url);
}

function extractMatchingYandexBooksUrlsForMergedBook(
  html: string,
  book: BookLike,
  searchBook: BookLike,
  baseUrl: string,
  options: FilterOptions,
): string[] {
  const results = extractYandexBooksSearchResults(html, baseUrl);
  const matches = filterYandexBooksResultsForBook(results, searchBook, options);

  if (matches.length > 0 || searchBook === book) {
    return matches.map((result) => result.url);
  }

  return filterYandexBooksResultsForBook(results, book, options)
    .map((result) => result.url);
}

function existingYandexBooksUrlsForBook(
  book: BookLike,
  existingBooksByUrl: ReadonlyMap<string | undefined, BookLike>
): string[] | null {
  const existingBook = existingBooksByUrl.get(book?.url);
  const { regularUrls } = splitAudiobookUrls(existingBook?.yandex_books_urls);
  if (regularUrls.length === 0) {
    return null;
  }

  return regularUrls;
}

function isYandexBooksHostUrl(rawUrl: unknown): boolean {
  const url = typeof rawUrl === 'string'
    ? rawUrl
    : typeof rawUrl === 'object' && rawUrl !== null && 'url' in rawUrl
      ? rawUrl.url
      : null;
  if (typeof url !== 'string') {
    return false;
  }

  const parsed = parseHttpUrl(url);
  return parsed
    ? isHostnameIn(parsed.hostname, ['books.yandex.ru'])
    : url.toLowerCase().includes('books.yandex.ru/');
}

function hasYandexBooksAudiobookUrl(book: BookLike | null | undefined): boolean {
  return [
    ...splitAudiobookUrls(book?.yandex_books_urls).audiobookUrls,
    ...(Array.isArray(book?.audiobooks_urls) ? book.audiobooks_urls : []),
  ].some(isYandexBooksHostUrl);
}

export function countBooksWithExistingYandexBooksUrls(
  books: readonly BookLike[],
  existingBooks: readonly BookLike[] = []
): number {
  const existingBooksByUrl = new Map(
    existingBooks
      .filter((book) => book?.url)
      .map((book) => [book.url, book]),
  );

  return books.filter((book) => (
    existingYandexBooksUrlsForBook(book, existingBooksByUrl)
    || hasYandexBooksAudiobookUrl(book)
  )).length;
}

export async function enrichBooksWithYandexBooksUrls(
  books: readonly BookLike[],
  {
    existingBooks = [],
    fetchSearchPage,
    profileDir,
    playwright,
    maxResults = Infinity,
    delayMs = 0,
    onSearchError = () => {},
    sleep = defaultSleep,
  }: EnrichBooksWithYandexBooksUrlsOptions = {},
): Promise<BookLike[]> {
  const enrichedBooks: BookLike[] = [];
  const existingBooksByUrl = new Map(
    existingBooks
      .filter((book) => book?.url)
      .map((book) => [book.url, book]),
  );
  const searchPageFetcher = fetchSearchPage
    ?? (await import('../browser/browser.mjs')).fetchYandexBooksSearchPageWithBrowser as SearchPageFetcher;
  let searchedBooks = 0;

  for (const book of books) {
    const searchBook = book[LIVELIB_SOURCE_BOOK] ?? book;
    const existingYandexBooksUrls = existingYandexBooksUrlsForBook(book, existingBooksByUrl);
    const existingYandexAudiobookUrls = splitAudiobookUrls(book.yandex_books_urls).audiobookUrls;
    if (existingYandexBooksUrls || hasYandexBooksAudiobookUrl(book)) {
      const mergedAudiobookUrls = mergeAudiobookUrls(book, existingYandexAudiobookUrls);
      const enrichedBook: BookLike = {
        ...book,
        yandex_books_urls: existingYandexBooksUrls ? [...existingYandexBooksUrls] : [],
      };

      if (
        mergedAudiobookUrls.length > 0
        || Object.prototype.hasOwnProperty.call(book, 'audiobooks_urls')
      ) {
        enrichedBook.audiobooks_urls = mergedAudiobookUrls;
      }

      enrichedBooks.push(enrichedBook);
      continue;
    }

    if (delayMs > 0 && searchedBooks > 0) {
      await sleep(delayMs);
    }

    const query = buildYandexBooksSearchQuery(searchBook);
    let searchPage: SearchPage;
    try {
      searchPage = await searchPageFetcher({
        query,
        profileDir,
        playwright,
      });
    } catch (error) {
      onSearchError({ book, query, error });
      const mergedAudiobookUrls = mergeAudiobookUrls(book, existingYandexAudiobookUrls);
      const enrichedBook: BookLike = {
        ...book,
        yandex_books_urls: [],
      };

      if (
        mergedAudiobookUrls.length > 0
        || Object.prototype.hasOwnProperty.call(book, 'audiobooks_urls')
      ) {
        enrichedBook.audiobooks_urls = mergedAudiobookUrls;
      }

      enrichedBooks.push(enrichedBook);
      searchedBooks += 1;
      continue;
    }

    const yandexBooksUrls = extractMatchingYandexBooksUrlsForMergedBook(
      searchPage.html,
      book,
      searchBook,
      searchPage.url,
      { maxResults },
    );
    const { regularUrls, audiobookUrls } = splitAudiobookUrls(yandexBooksUrls);
    const mergedAudiobookUrls = mergeAudiobookUrls(book, [
      ...existingYandexAudiobookUrls,
      ...audiobookUrls,
    ]);
    const enrichedBook: BookLike = {
      ...book,
      yandex_books_urls: regularUrls,
    };

    if (
      mergedAudiobookUrls.length > 0
      || Object.prototype.hasOwnProperty.call(book, 'audiobooks_urls')
    ) {
      enrichedBook.audiobooks_urls = mergedAudiobookUrls;
    }

    enrichedBooks.push(enrichedBook);
    searchedBooks += 1;
  }

  return enrichedBooks;
}
