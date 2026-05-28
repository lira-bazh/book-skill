import { load } from 'cheerio';

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

const YANDEX_BOOKS_ITEM_PATH_RE = /^\/(?:books|audiobooks)\/[^/]+$/;
const YANDEX_BOOKS_ET_AL_RE = /(?:^|[\s,;])(?:и\s+)?др\.?$/iu;

export function isSimilarYandexBooksTitle(sourceTitle, candidateTitle) {
  const source = normalizeForMatch(sourceTitle);
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

export function isSimilarYandexBooksAuthor(sourceAuthor, candidateAuthor) {
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

function isAbbreviatedYandexBooksAuthorMatch(sourceAuthor, candidateAuthor) {
  return areAuthorNamePartsCompatible(
    splitYandexBooksAuthorName(sourceAuthor),
    splitYandexBooksAuthorName(candidateAuthor),
  ) || areAuthorNamePartsCompatible(
    splitYandexBooksAuthorName(candidateAuthor),
    splitYandexBooksAuthorName(sourceAuthor),
  );
}

function splitYandexBooksAuthorName(author) {
  return normalizeForMatch(author).split(' ').filter(Boolean);
}

function areAuthorNamePartsCompatible(fullNameParts, abbreviatedNameParts) {
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

  const firstAbbreviatedName = abbreviatedGivenNames[0];
  const firstFullName = fullGivenNames[0];
  const firstNameMatches = firstAbbreviatedName.length === 1
    ? firstFullName.startsWith(firstAbbreviatedName)
    : firstAbbreviatedName === firstFullName;

  return firstNameMatches && abbreviatedGivenNames.every((abbreviatedName) => (
    abbreviatedName.length === 1 || fullGivenNames.includes(abbreviatedName)
  ));
}

export function buildYandexBooksSearchQuery(book) {
  return buildBookSearchQuery(book);
}

export function buildYandexBooksSearchUrl(query) {
  const normalizedQuery = cleanText(query);
  if (!normalizedQuery) {
    throw new Error('Yandex Books search query must not be empty');
  }

  return `https://books.yandex.ru/search/all/${encodeURIComponent(normalizedQuery)}`;
}

export function normalizeYandexBooksUrl(rawUrl, baseUrl = 'https://books.yandex.ru/') {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== 'books.yandex.ru') {
    return null;
  }

  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  if (!YANDEX_BOOKS_ITEM_PATH_RE.test(normalizedPath)) {
    return null;
  }

  return `https://books.yandex.ru${normalizedPath}`;
}

export function extractYandexBooksUrls(html, baseUrl = 'https://books.yandex.ru/') {
  const urls = [];
  const seen = new Set();

  for (const href of extractHrefValues(html)) {
    const normalizedUrl = normalizeYandexBooksUrl(href, baseUrl);
    if (normalizedUrl && !seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      urls.push(normalizedUrl);
    }
  }

  return urls;
}

export function extractYandexBooksSearchResults(html, baseUrl = 'https://books.yandex.ru/') {
  const $ = load(html);
  const results = [];
  const seen = new Set();

  const pushResult = ({ title, authors, url }) => {
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

function extractYandexBooksResultTitle($, link, card, baseUrl) {
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

function extractYandexBooksAuthors($, container) {
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

function isHiddenYandexBooksAuthor($, author) {
  const classNames = ($(author).attr('class') ?? '').split(/\s+/u);
  return classNames.some((className) => className.startsWith('SnippetAuthorsOneLine_hide__'));
}

function cleanYandexBooksAuthorName(author) {
  return cleanText(author).replace(YANDEX_BOOKS_ET_AL_RE, '').trim();
}

function findYandexBooksResultCard($, link, baseUrl) {
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

export function isYandexBooksResultSimilarToBook(result, book) {
  return isSearchResultSimilarToBook(result, book);
}

export function filterYandexBooksResultsForBook(results, book, { maxResults = Infinity } = {}) {
  return filterSearchResultsForBook(results, book, { maxResults });
}

export function extractMatchingYandexBooksUrls(
  html,
  book,
  baseUrl = 'https://books.yandex.ru/',
  options = {},
) {
  return filterYandexBooksResultsForBook(
    extractYandexBooksSearchResults(html, baseUrl),
    book,
    options,
  ).map((result) => result.url);
}

function existingYandexBooksUrlsForBook(book, existingBooksByUrl) {
  const existingBook = existingBooksByUrl.get(book?.url);
  if (!Array.isArray(existingBook?.yandex_books_urls) || existingBook.yandex_books_urls.length === 0) {
    return null;
  }

  return existingBook.yandex_books_urls;
}

export function countBooksWithExistingYandexBooksUrls(books, existingBooks = []) {
  const existingBooksByUrl = new Map(
    existingBooks
      .filter((book) => book?.url)
      .map((book) => [book.url, book]),
  );

  return books.filter((book) => (
    existingYandexBooksUrlsForBook(book, existingBooksByUrl)
  )).length;
}

export async function enrichBooksWithYandexBooksUrls(
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
  const searchPageFetcher = fetchSearchPage
    ?? (await import('./browser.mjs')).fetchYandexBooksSearchPageWithBrowser;
  let searchedBooks = 0;

  for (const book of books) {
    const existingYandexBooksUrls = existingYandexBooksUrlsForBook(book, existingBooksByUrl);
    if (existingYandexBooksUrls) {
      enrichedBooks.push({
        ...book,
        yandex_books_urls: [...existingYandexBooksUrls],
      });
      continue;
    }

    if (delayMs > 0 && searchedBooks > 0) {
      await sleep(delayMs);
    }

    const query = buildYandexBooksSearchQuery(book);
    let searchPage;
    try {
      searchPage = await searchPageFetcher({
        query,
        profileDir,
        playwright,
      });
    } catch (error) {
      onSearchError({ book, query, error });
      enrichedBooks.push({
        ...book,
        yandex_books_urls: [],
      });
      searchedBooks += 1;
      continue;
    }

    const yandexBooksUrls = extractMatchingYandexBooksUrls(searchPage.html, book, searchPage.url, {
      maxResults,
    });

    enrichedBooks.push({
      ...book,
      yandex_books_urls: yandexBooksUrls,
    });
    searchedBooks += 1;
  }

  return enrichedBooks;
}
