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
  stripTrailingSlash,
} from '../core/text-match.mjs';
import { buildBookSearchQuery } from '../books/book-search-query.mjs';
import {
  filterSearchResultsForBook,
  isSearchResultSimilarToBook,
} from '../books/book-search-match.mjs';
import { mergeAudiobookUrls, splitAudiobookUrls } from '../books/book-url-fields.mjs';

type BookLike = Record<string, unknown> & {
  title?: unknown;
  authors?: unknown;
  url?: string;
  litres_urls?: unknown;
  audiobooks_urls?: unknown;
};

type LitresSearchResult = {
  title: string;
  authors: string[];
  url: string;
};

type FilterOptions = {
  maxResults?: number;
};

type SearchPage = string | {
  url?: string | null;
  html?: string | null;
};

type SearchPageFetcher = (options: {
  searchUrl: string;
  query: string;
  book: BookLike;
  profileDir?: unknown;
  playwright?: unknown;
}) => Promise<SearchPage> | SearchPage;

type EnrichBooksWithLitresUrlsOptions = {
  existingBooks?: readonly BookLike[];
  fetchSearchPage?: SearchPageFetcher;
  profileDir?: unknown;
  playwright?: unknown;
  maxResults?: number;
  delayMs?: number;
  onSearchError?: (details: {
    book: BookLike;
    query: string;
    searchUrl: string;
    error: unknown;
  }) => void;
  sleep?: (ms: number) => Promise<unknown>;
};

type LitresAudiobookJsonLd = {
  '@type'?: unknown;
  duration?: unknown;
  readBy?: unknown;
};

type JsonLdPerson = {
  name?: unknown;
};

type CheerioSelection = ReturnType<CheerioAPI>;
type CheerioArgument = Parameters<CheerioAPI>[0];

const LITRES_ITEM_PATH_RE = /^\/(?:book|audiobook)\/[^/]+(?:\/[^/]+)*$/;
const LITRES_AD_URL_PARAM_NAMES = new Set([
  'banner_id',
  'banner_title',
  'campaign_id',
  'erid',
]);
const LITRES_AD_URL_PARAM_VALUES = new Set(['banners']);
const LITRES_AD_TEXT_RE = /(?:advert|advertising|banner|promo|реклама|баннер)/iu;
const NON_TITLE_TEXT_RE = /^(?:купить|читать|слушать|скачать|подробнее|в корзину|фрагмент|слушать фрагмент|читать онлайн|отложить|оценить|\d+(?:[.,]\d+)?\s*(?:₽|руб\.?|р\.?))$/i;
const TITLE_FORMAT_NOTE_RE = /\s*\((?:сборник)\)\s*/giu;
const AUTHOR_ET_AL_RE = /(?:^|[\s,;])и\s+др\.?$/iu;
const AUTHOR_SEPARATOR_RE = /\s*(?:[,;]|\s+[&+]\s+)\s*/u;
const LITRES_NARRATOR_LABEL = 'Чтец';
const LITRES_READER_DETAILS_TEST_ID = 'art__reader--details';
const LITRES_PERSON_NAME_LINK_TEST_ID = 'art__personName--link';
const JSON_LD_SCRIPT_RE = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;

export function extractLitresAudiobookNarrator(html: unknown): string | null {
  return extractLitresAudiobookNarratorFromJsonLd(html)
    ?? extractLitresAudiobookNarratorFromReaderDetails(html)
    ?? extractLabeledPageTextValue(html, [LITRES_NARRATOR_LABEL]);
}

export function extractLitresAudiobookDurationMinutes(html: unknown): number | null {
  const duration = extractLitresAudiobookJsonLd(html)?.duration;
  if (typeof duration !== 'string') {
    return null;
  }

  const durationMatch = duration.match(/^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)$/u);
  if (!durationMatch) {
    return null;
  }

  const hours = Number.parseInt(durationMatch[1] ?? '0', 10);
  const minutes = Number.parseInt(durationMatch[2] ?? '0', 10);
  const seconds = Number.parseInt(durationMatch[3] ?? '0', 10);
  const totalMinutes = hours * 60 + minutes + Math.floor(seconds / 60);

  return totalMinutes > 0 ? totalMinutes : null;
}

function extractLitresAudiobookNarratorFromJsonLd(html: unknown): string | null {
  const readBy = extractLitresAudiobookJsonLd(html)?.readBy;
  const readers = Array.isArray(readBy) ? readBy : [readBy];
  const names = readers
    .map((reader) => cleanText(asJsonLdPerson(reader)?.name))
    .filter(Boolean)
    .filter((name, index, values) => values.indexOf(name) === index);

  return names.length > 0 ? names.join(', ') : null;
}

function extractLitresAudiobookJsonLd(html: unknown): LitresAudiobookJsonLd | null {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  for (const match of html.matchAll(JSON_LD_SCRIPT_RE)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1] ?? '');
    } catch {
      continue;
    }

    if (isJsonObject(data) && data['@type'] === 'Audiobook') {
      return data;
    }
  }

  return null;
}

function extractLitresAudiobookNarratorFromReaderDetails(html: unknown): string | null {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  const $ = load(html);
  const narratorNames = $(`[data-testid="${LITRES_READER_DETAILS_TEST_ID}"]`)
    .find(`[data-testid="${LITRES_PERSON_NAME_LINK_TEST_ID}"]`)
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean)
    .filter((name, index, names) => names.indexOf(name) === index);

  return narratorNames.length > 0 ? narratorNames.join(', ') : null;
}

function normalizeLitresTitleForMatch(title: unknown): string {
  return normalizeForMatch(cleanText(title).replace(TITLE_FORMAT_NOTE_RE, ' '));
}

export function isSimilarLitresTitle(sourceTitle: unknown, candidateTitle: unknown): boolean {
  const source = normalizeLitresTitleForMatch(sourceTitle);
  const candidate = normalizeLitresTitleForMatch(candidateTitle);

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

export function isSimilarLitresAuthor(sourceAuthor: unknown, candidateAuthor: unknown): boolean {
  const sourceVariants = normalizeLitresAuthorVariants(sourceAuthor);
  const candidateVariants = normalizeLitresAuthorVariants(candidateAuthor);

  return sourceVariants.some((source) => (
    candidateVariants.some((candidate) => (
      source === candidate ||
      candidate.includes(source) ||
      source.includes(candidate) ||
      hasTokenOverlap(source, candidate, 0.66)
    ))
  ));
}

function normalizeLitresAuthorVariants(author: unknown): string[] {
  const cleanedAuthor = cleanText(author).replace(AUTHOR_ET_AL_RE, '');
  const variants = [cleanedAuthor, ...cleanedAuthor.split(AUTHOR_SEPARATOR_RE)];

  return variants
    .map((variant) => normalizeForMatch(variant))
    .filter(Boolean)
    .filter((variant, index, values) => values.indexOf(variant) === index);
}

export function buildLitresSearchQuery(book: BookLike | null | undefined): string {
  return buildBookSearchQuery({
    title: typeof book?.title === 'string' ? book.title : null,
    authors: Array.isArray(book?.authors) ? book.authors : null,
  });
}

export function buildLitresSearchUrl(query: unknown): string {
  const normalizedQuery = cleanText(query);
  if (!normalizedQuery) {
    throw new Error('Litres search query must not be empty');
  }

  const url = new URL('https://www.litres.ru/search/');
  url.searchParams.set('q', normalizedQuery);
  return url.toString();
}

export function normalizeLitresUrl(
  rawUrl: string | undefined,
  baseUrl = 'https://www.litres.ru/'
): string | null {
  const parsed = parseHttpUrl(rawUrl, baseUrl);
  if (!parsed || !isHostnameIn(parsed.hostname, ['www.litres.ru', 'litres.ru'])) {
    return null;
  }

  const normalizedPath = stripTrailingSlash(parsed.pathname);
  if (!LITRES_ITEM_PATH_RE.test(normalizedPath)) {
    return null;
  }

  return `https://www.litres.ru${normalizedPath}`;
}

export function extractLitresUrls(
  html: string,
  baseUrl = 'https://www.litres.ru/'
): string[] {
  return extractNormalizedHrefUrls(html, baseUrl, normalizeLitresUrl);
}

function uniqueTexts(values: readonly unknown[]): string[] {
  return values
    .map((value) => cleanText(value))
    .filter(Boolean)
    .filter((value, index, allValues) => allValues.indexOf(value) === index);
}

function isUsefulTitleText(value: unknown): boolean {
  const text = cleanText(value);
  return text.length > 1
    && text.length <= 220
    && /\p{L}/u.test(text)
    && !NON_TITLE_TEXT_RE.test(text);
}

function getElementSearchText(element: unknown): string {
  const attribs = isJsonObject(element) && isJsonObject(element.attribs)
    ? element.attribs
    : {};
  return [
    attribs.class,
    attribs['data-testid'],
    attribs['data-test-id'],
    attribs.itemprop,
    attribs.id,
  ].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
}

function isLitresAdUrl(rawUrl: string | undefined, baseUrl: string): boolean {
  const parsed = parseHttpUrl(rawUrl, baseUrl);
  if (!parsed) {
    return false;
  }

  for (const [name, value] of parsed.searchParams) {
    const normalizedName = name.toLowerCase();
    const normalizedValue = value.toLowerCase();
    if (
      LITRES_AD_URL_PARAM_NAMES.has(normalizedName)
      || LITRES_AD_URL_PARAM_VALUES.has(normalizedValue)
    ) {
      return true;
    }
  }

  return false;
}

function isLitresAdScope($: CheerioAPI, scope: CheerioSelection): boolean {
  return scope
    .parents()
    .addBack()
    .toArray()
    .some((element) => LITRES_AD_TEXT_RE.test(getElementSearchText(element)))
    || LITRES_AD_TEXT_RE.test(cleanText(scope.text()));
}

function collectTitleCandidates(
  $: CheerioAPI,
  link: CheerioSelection,
  scope: CheerioSelection,
  url: string,
  baseUrl: string
): string[] {
  const candidates: unknown[] = [];

  for (const attrName of ['title', 'aria-label']) {
    candidates.push(link.attr(attrName));
  }
  candidates.push(link.text());

  scope.find('h1, h2, h3, [itemprop="name"], a[href]').each((_, element) => {
    const candidate = $(element);
    const href = candidate.attr('href');
    const isSameBookLink = href && normalizeLitresUrl(href, baseUrl) === url;
    const searchText = getElementSearchText(element);
    const looksLikeTitle = searchText.includes('title')
      || searchText.includes('name')
      || searchText.includes('book');

    if (isSameBookLink || looksLikeTitle) {
      candidates.push(candidate.attr('title'));
      candidates.push(candidate.attr('aria-label'));
      candidates.push(candidate.text());
    }
  });

  return uniqueTexts(candidates).filter(isUsefulTitleText);
}

export function extractLitresSearchResults(
  html: string,
  baseUrl = 'https://www.litres.ru/'
): LitresSearchResult[] {
  const $ = load(html);
  const results: LitresSearchResult[] = [];

  $('[data-testid="art__wrapper"]').each((_, element) => {
    const scope = $(element);
    if (isLitresAdScope($, scope)) {
      return;
    }

    const link = scope
      .find('a[href]')
      .toArray()
      .map((linkElement) => $(linkElement))
      .find((candidate) => normalizeLitresUrl(candidate.attr('href'), baseUrl));
    if (!link) {
      return;
    }

    const href = link.attr('href');
    if (isLitresAdUrl(href, baseUrl)) {
      return;
    }

    const url = normalizeLitresUrl(href, baseUrl);
    if (!url) {
      return;
    }

    const titleCandidates = collectTitleCandidates($, link, scope, url, baseUrl);
    const authors = scope.find('a[href*="/author/"], [data-testid*="author"], [class*="author"]')
      .toArray()
      .map((author) => cleanText($(author).text()))
      .filter(Boolean)
      .filter((author, index, values) => values.indexOf(author) === index);

    if (titleCandidates.length === 0) {
      return;
    }

    results.push({
      title: titleCandidates[0] ?? '',
      authors,
      url,
    });
  });

  return results;
}

export function isLitresResultSimilarToBook(
  result: LitresSearchResult | null | undefined,
  book: BookLike | null | undefined
): boolean {
  return isSearchResultSimilarToBook(result, book);
}

export function filterLitresResultsForBook<Result extends LitresSearchResult>(
  results: readonly Result[],
  book: BookLike | null | undefined,
  { maxResults = Infinity }: FilterOptions = {}
): Result[] {
  return filterSearchResultsForBook(results, book, { maxResults });
}

export function extractMatchingLitresUrls(
  html: string,
  book: BookLike | null | undefined,
  baseUrl = 'https://www.litres.ru/',
  options: FilterOptions = {},
): string[] {
  return filterLitresResultsForBook(
    extractLitresSearchResults(html, baseUrl),
    book,
    options,
  ).map((result) => result.url);
}

function existingLitresUrlsForBook(
  book: BookLike,
  existingBooksByUrl: ReadonlyMap<string | undefined, BookLike>
): string[] | null {
  const existingBook = existingBooksByUrl.get(book?.url);
  const { regularUrls } = splitAudiobookUrls(existingBook?.litres_urls);
  if (regularUrls.length === 0) {
    return null;
  }

  return regularUrls;
}

function isLitresHostUrl(rawUrl: unknown): boolean {
  const url = typeof rawUrl === 'string'
    ? rawUrl
    : isJsonObject(rawUrl)
      ? rawUrl.url
      : null;
  if (typeof url !== 'string') {
    return false;
  }

  const parsed = parseHttpUrl(url);
  if (parsed) {
    return isHostnameIn(parsed.hostname, ['www.litres.ru', 'litres.ru']);
  }

  const normalizedUrl = url.toLowerCase();
  return normalizedUrl.includes('www.litres.ru/') || normalizedUrl.includes('litres.ru/');
}

function hasLitresAudiobookUrl(book: BookLike | null | undefined): boolean {
  return [
    ...splitAudiobookUrls(book?.litres_urls).audiobookUrls,
    ...(Array.isArray(book?.audiobooks_urls) ? book.audiobooks_urls : []),
  ].some(isLitresHostUrl);
}

export function countBooksWithExistingLitresUrls(
  books: readonly BookLike[],
  existingBooks: readonly BookLike[] = []
): number {
  const existingBooksByUrl = new Map(
    existingBooks
      .filter((book) => book?.url)
      .map((book) => [book.url, book]),
  );

  return books.filter((book) => (
    existingLitresUrlsForBook(book, existingBooksByUrl)
    || hasLitresAudiobookUrl(book)
  )).length;
}

export async function enrichBooksWithLitresUrls(
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
  }: EnrichBooksWithLitresUrlsOptions = {},
): Promise<BookLike[]> {
  const enrichedBooks: BookLike[] = [];
  const existingBooksByUrl = new Map(
    existingBooks
      .filter((book) => book?.url)
      .map((book) => [book.url, book]),
  );

  if (typeof fetchSearchPage !== 'function') {
    throw new Error('Litres search page fetcher is required');
  }

  for (const book of books) {
    const existingLitresUrls = existingLitresUrlsForBook(book, existingBooksByUrl);
    const existingLitresAudiobookUrls = splitAudiobookUrls(book.litres_urls).audiobookUrls;
    if (existingLitresUrls || hasLitresAudiobookUrl(book)) {
      enrichedBooks.push({
        ...book,
        litres_urls: existingLitresUrls ?? [],
        audiobooks_urls: mergeAudiobookUrls(book, existingLitresAudiobookUrls),
      });
      continue;
    }

    const query = buildLitresSearchQuery(book);
    if (!query) {
      enrichedBooks.push({
        ...book,
        litres_urls: [],
        audiobooks_urls: mergeAudiobookUrls(book, existingLitresAudiobookUrls),
      });
      continue;
    }

    const searchUrl = buildLitresSearchUrl(query);
    let litresUrls: string[] = [];

    try {
      const searchPage = await fetchSearchPage({
        searchUrl,
        query,
        book,
        profileDir,
        playwright,
      });
      const html = typeof searchPage === 'string' ? searchPage : searchPage?.html;
      const baseUrl = typeof searchPage === 'string' ? searchUrl : searchPage?.url ?? searchUrl;

      litresUrls = extractMatchingLitresUrls(html ?? '', book, baseUrl, { maxResults });
    } catch (error) {
      onSearchError({ book, query, searchUrl, error });
    }

    const { regularUrls, audiobookUrls } = splitAudiobookUrls(litresUrls);
    enrichedBooks.push({
      ...book,
      litres_urls: regularUrls,
      audiobooks_urls: mergeAudiobookUrls(book, [
        ...existingLitresAudiobookUrls,
        ...audiobookUrls,
      ]),
    });

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return enrichedBooks;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asJsonLdPerson(value: unknown): JsonLdPerson | null {
  return isJsonObject(value) ? value : null;
}
