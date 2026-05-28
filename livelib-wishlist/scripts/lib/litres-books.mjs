import { load } from 'cheerio';

import { extractLabeledPageTextValue } from './audiobook-page-fields.mjs';
import {
  cleanText,
  extractHrefValues,
  hasTokenOverlap,
  normalizeForMatch,
} from './text-match.mjs';
import { buildBookSearchQuery } from './book-search-query.mjs';
import {
  filterSearchResultsForBook,
  isSearchResultSimilarToBook,
} from './book-search-match.mjs';
import { mergeAudiobookUrls, splitAudiobookUrls } from './book-url-fields.mjs';

const LITRES_ITEM_PATH_RE = /^\/(?:book|audiobook)\/[^/]+(?:\/[^/]+)*$/;
const NON_TITLE_TEXT_RE = /^(?:купить|читать|слушать|скачать|подробнее|в корзину|фрагмент|слушать фрагмент|читать онлайн|отложить|оценить|\d+(?:[.,]\d+)?\s*(?:₽|руб\.?|р\.?))$/i;
const TITLE_FORMAT_NOTE_RE = /\s*\((?:сборник)\)\s*/giu;
const AUTHOR_ET_AL_RE = /(?:^|[\s,;])и\s+др\.?$/iu;
const AUTHOR_SEPARATOR_RE = /\s*(?:[,;]|\s+[&+]\s+)\s*/u;
const LITRES_NARRATOR_LABEL = 'Чтец';
const LITRES_READER_DETAILS_TEST_ID = 'art__reader--details';
const LITRES_PERSON_NAME_LINK_TEST_ID = 'art__personName--link';

export function extractLitresAudiobookNarrator(html) {
  return extractLitresAudiobookNarratorFromReaderDetails(html)
    ?? extractLabeledPageTextValue(html, [LITRES_NARRATOR_LABEL]);
}

function extractLitresAudiobookNarratorFromReaderDetails(html) {
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

function normalizeLitresTitleForMatch(title) {
  return normalizeForMatch(cleanText(title).replace(TITLE_FORMAT_NOTE_RE, ' '));
}

export function isSimilarLitresTitle(sourceTitle, candidateTitle) {
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

export function isSimilarLitresAuthor(sourceAuthor, candidateAuthor) {
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

function normalizeLitresAuthorVariants(author) {
  const cleanedAuthor = cleanText(author).replace(AUTHOR_ET_AL_RE, '');
  const variants = [cleanedAuthor, ...cleanedAuthor.split(AUTHOR_SEPARATOR_RE)];

  return variants
    .map((variant) => normalizeForMatch(variant))
    .filter(Boolean)
    .filter((variant, index, values) => values.indexOf(variant) === index);
}

export function buildLitresSearchQuery(book) {
  return buildBookSearchQuery(book);
}

export function buildLitresSearchUrl(query) {
  const normalizedQuery = cleanText(query);
  if (!normalizedQuery) {
    throw new Error('Litres search query must not be empty');
  }

  const url = new URL('https://www.litres.ru/search/');
  url.searchParams.set('q', normalizedQuery);
  return url.toString();
}

export function normalizeLitresUrl(rawUrl, baseUrl = 'https://www.litres.ru/') {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'www.litres.ru' && hostname !== 'litres.ru') {
    return null;
  }

  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  if (!LITRES_ITEM_PATH_RE.test(normalizedPath)) {
    return null;
  }

  return `https://www.litres.ru${normalizedPath}`;
}

export function extractLitresUrls(html, baseUrl = 'https://www.litres.ru/') {
  const urls = [];
  const seen = new Set();

  for (const href of extractHrefValues(html)) {
    const normalizedUrl = normalizeLitresUrl(href, baseUrl);
    if (normalizedUrl && !seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      urls.push(normalizedUrl);
    }
  }

  return urls;
}

function uniqueTexts(values) {
  return values
    .map((value) => cleanText(value))
    .filter(Boolean)
    .filter((value, index, allValues) => allValues.indexOf(value) === index);
}

function isUsefulTitleText(value) {
  const text = cleanText(value);
  return text.length > 1
    && text.length <= 220
    && /\p{L}/u.test(text)
    && !NON_TITLE_TEXT_RE.test(text);
}

function getElementSearchText(element) {
  const attribs = element?.attribs ?? {};
  return [
    attribs.class,
    attribs['data-testid'],
    attribs['data-test-id'],
    attribs.itemprop,
    attribs.id,
  ].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
}

function collectTitleCandidates($, link, scope, url, baseUrl) {
  const candidates = [];

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

function mergeAuthors(currentAuthors, nextAuthors) {
  return uniqueTexts([...currentAuthors, ...nextAuthors]);
}

export function extractLitresSearchResults(html, baseUrl = 'https://www.litres.ru/') {
  const $ = load(html);
  const resultsByUrl = new Map();

  $('a[href]').each((_, element) => {
    const link = $(element);
    const url = normalizeLitresUrl(link.attr('href'), baseUrl);
    if (!url) {
      return;
    }

    const container = link.closest('article, li, [data-testid], .art-item, .book-card, .card');
    const scope = container.length > 0 ? container : link.parent();
    const titleCandidates = collectTitleCandidates($, link, scope, url, baseUrl);
    const authors = scope.find('a[href*="/author/"], [data-testid*="author"], [class*="author"]')
      .toArray()
      .map((author) => cleanText($(author).text()))
      .filter(Boolean)
      .filter((author, index, values) => values.indexOf(author) === index);

    const existingResult = resultsByUrl.get(url);
    if (existingResult) {
      const nextTitle = titleCandidates[0];
      resultsByUrl.set(url, {
        title: isUsefulTitleText(existingResult.title) ? existingResult.title : nextTitle,
        authors: mergeAuthors(existingResult.authors, authors),
        url,
      });
      return;
    }

    if (titleCandidates.length === 0) {
      return;
    }

    resultsByUrl.set(url, {
      title: titleCandidates[0],
      authors,
      url,
    });
  });

  return [...resultsByUrl.values()];
}

export function isLitresResultSimilarToBook(result, book) {
  return isSearchResultSimilarToBook(result, book);
}

export function filterLitresResultsForBook(results, book, { maxResults = Infinity } = {}) {
  return filterSearchResultsForBook(results, book, { maxResults });
}

export function extractMatchingLitresUrls(
  html,
  book,
  baseUrl = 'https://www.litres.ru/',
  options = {},
) {
  return filterLitresResultsForBook(
    extractLitresSearchResults(html, baseUrl),
    book,
    options,
  ).map((result) => result.url);
}

function existingLitresUrlsForBook(book, existingBooksByUrl) {
  const existingBook = existingBooksByUrl.get(book?.url);
  const { regularUrls } = splitAudiobookUrls(existingBook?.litres_urls);
  if (regularUrls.length === 0) {
    return null;
  }

  return regularUrls;
}

export function countBooksWithExistingLitresUrls(books, existingBooks = []) {
  const existingBooksByUrl = new Map(
    existingBooks
      .filter((book) => book?.url)
      .map((book) => [book.url, book]),
  );

  return books.filter((book) => (
    existingLitresUrlsForBook(book, existingBooksByUrl)
  )).length;
}

export async function enrichBooksWithLitresUrls(
  books,
  {
    existingBooks = [],
    fetchSearchPage,
    profileDir,
    playwright,
    maxResults = Infinity,
    delayMs = 0,
    onSearchError = () => {},
    sleep = (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  } = {},
) {
  const enrichedBooks = [];
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
    if (existingLitresUrls) {
      enrichedBooks.push({
        ...book,
        litres_urls: existingLitresUrls,
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
    let litresUrls = [];

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
