import { load } from 'cheerio';

import {
  cleanText,
  extractHrefValues,
  hasTokenOverlap,
  normalizeForMatch,
} from './text-match.mjs';

const YANDEX_BOOKS_ITEM_PATH_RE = /^\/(?:books|audiobooks)\/[^/]+$/;

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
    hasTokenOverlap(source, candidate, 0.66)
  );
}

export function buildYandexBooksSearchQuery(book) {
  const title = cleanText(book?.title);
  const authors = Array.isArray(book?.authors) ? book.authors : [];
  const uniqueAuthors = authors
    .map((author) => cleanText(author))
    .filter(Boolean)
    .filter((author, index, values) => values.indexOf(author) === index);

  return [title, ...uniqueAuthors].filter(Boolean).join(' ');
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

    const authors = snippet.find('[data-test-id="SNIPPET_AUTHORS"]')
      .toArray()
      .map((author) => cleanText($(author).text()))
      .filter(Boolean)
      .filter((author, index, values) => values.indexOf(author) === index);

    seen.add(url);
    results.push({ title, authors, url });
  });

  return results;
}

export function isYandexBooksResultSimilarToBook(result, book) {
  if (!isSimilarYandexBooksTitle(book?.title, result?.title)) {
    return false;
  }

  const sourceAuthors = Array.isArray(book?.authors) ? book.authors.filter((author) => cleanText(author)) : [];
  if (sourceAuthors.length === 0) {
    return true;
  }

  const candidateAuthors = Array.isArray(result?.authors) ? result.authors.filter((author) => cleanText(author)) : [];
  if (candidateAuthors.length === 0) {
    return false;
  }

  return sourceAuthors.some((sourceAuthor) => (
    candidateAuthors.some((candidateAuthor) => (
      isSimilarYandexBooksAuthor(sourceAuthor, candidateAuthor)
    ))
  ));
}

export function filterYandexBooksResultsForBook(results, book, { maxResults = Infinity } = {}) {
  const matched = [];
  const seen = new Set();

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

export async function enrichBooksWithYandexBooksUrls(
  books,
  {
    fetchSearchPage,
    profileDir,
    playwright,
    maxResults = Infinity,
  } = {},
) {
  const enrichedBooks = [];
  const searchPageFetcher = fetchSearchPage
    ?? (await import('./browser.mjs')).fetchYandexBooksSearchPageWithBrowser;

  for (const book of books) {
    const query = buildYandexBooksSearchQuery(book);
    const searchPage = await searchPageFetcher({
      query,
      profileDir,
      playwright,
    });
    const yandexBooksUrls = extractMatchingYandexBooksUrls(searchPage.html, book, searchPage.url, {
      maxResults,
    });

    enrichedBooks.push({
      ...book,
      yandex_books_urls: yandexBooksUrls,
    });
  }

  return enrichedBooks;
}
