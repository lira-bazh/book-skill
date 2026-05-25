import { load } from 'cheerio';

import { cleanText, extractHrefValues } from './text-match.mjs';

const WISHLIST_PATH_RE = /^\/reader\/([^/]+)\/wish\/?$/;
const BOOK_ITEM_PATH_RE = /^\/(?:book|work)\/[^/]+$/;

export class LiveLibAccessError extends Error {}

export function parseLivelibWishlistUrl(rawUrl) {
  const parsed = new URL(rawUrl);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must use http or https');
  }

  if (parsed.hostname.toLowerCase() !== 'www.livelib.ru') {
    throw new Error('URL host must be www.livelib.ru');
  }

  const match = parsed.pathname.match(WISHLIST_PATH_RE);
  if (!match) {
    throw new Error('URL path must look like /reader/<username>/wish');
  }

  return {
    username: match[1],
    url: `https://www.livelib.ru${parsed.pathname.replace(/\/$/, '')}`,
  };
}

export function normalizeWishlistPageUrl(rawUrl, username, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== 'www.livelib.ru') {
    return null;
  }

  const expectedPath = `/reader/${username}/wish`;
  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  const listViewPrefix = `${expectedPath}/listview/smalllist/~`;

  if (normalizedPath.startsWith(listViewPrefix)) {
    const pageValue = normalizedPath.slice(listViewPrefix.length);
    const pageNumber = Number.parseInt(pageValue, 10);

    if (String(pageNumber) !== pageValue || pageNumber < 2 || parsed.search) {
      return null;
    }

    return `https://www.livelib.ru${listViewPrefix}${pageNumber}`;
  }

  if (normalizedPath !== expectedPath) {
    return null;
  }

  const pageValues = parsed.searchParams.getAll('page');
  const allowedParams = new Set(['page']);
  const hasOnlyPaginationParams = [...parsed.searchParams.keys()]
    .every((name) => allowedParams.has(name));

  if (pageValues.length !== 1 || !hasOnlyPaginationParams) {
    return null;
  }

  const pageNumber = Number.parseInt(pageValues[0], 10);
  if (String(pageNumber) !== pageValues[0] || pageNumber < 2) {
    return null;
  }

  return `https://www.livelib.ru${expectedPath}?page=${pageNumber}`;
}

export function getWishlistPaginationPageNumber(rawUrl, username) {
  const parsed = new URL(rawUrl);
  const expectedPath = `/reader/${username}/wish`;
  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  const listViewPrefix = `${expectedPath}/listview/smalllist/~`;

  if (normalizedPath.startsWith(listViewPrefix)) {
    return Number.parseInt(normalizedPath.slice(listViewPrefix.length), 10);
  }

  if (normalizedPath === expectedPath) {
    return Number.parseInt(parsed.searchParams.get('page'), 10);
  }

  return null;
}

export function extractWishlistPageUrls(html, username, baseUrl) {
  const urls = [];
  const seenPageNumbers = new Set();

  for (const href of extractHrefValues(html)) {
    const normalizedUrl = normalizeWishlistPageUrl(href, username, baseUrl);
    if (!normalizedUrl) {
      continue;
    }

    const pageNumber = getWishlistPaginationPageNumber(normalizedUrl, username);
    if (!seenPageNumbers.has(pageNumber)) {
      seenPageNumbers.add(pageNumber);
      urls.push(normalizedUrl);
    }
  }

  return urls;
}

export function isWishlistContentUrl(rawUrl, username, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return false;
  }

  const expectedPath = `/reader/${username}/wish`;
  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  if (
    parsed.hostname.toLowerCase() === 'www.livelib.ru' &&
    normalizedPath === expectedPath &&
    parsed.search === ''
  ) {
    return true;
  }

  return normalizeWishlistPageUrl(rawUrl, username, baseUrl) !== null;
}

export function normalizeBookUrl(rawUrl, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== 'www.livelib.ru') {
    return null;
  }

  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  if (!BOOK_ITEM_PATH_RE.test(normalizedPath)) {
    return null;
  }

  return `https://www.livelib.ru${normalizedPath}`;
}

export function extractBookUrls(html, baseUrl) {
  const urls = [];
  const seen = new Set();

  for (const href of extractHrefValues(html)) {
    const normalizedUrl = normalizeBookUrl(href, baseUrl);
    if (normalizedUrl && !seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      urls.push(normalizedUrl);
    }
  }

  return urls;
}

export function extractBooks(html, baseUrl) {
  const $ = load(html);
  const books = [];
  const seen = new Set();
  let links = $('a.brow-book-name[href]').toArray();

  if (links.length === 0) {
    links = $('a[href]').toArray().filter((element) => {
      const title = cleanText($(element).text());
      return title && normalizeBookUrl($(element).attr('href'), baseUrl);
    });
  }

  for (const element of links) {
    const link = $(element);
    const url = normalizeBookUrl(link.attr('href'), baseUrl);
    if (!url || seen.has(url)) {
      continue;
    }

    const title = cleanText(link.text());
    if (!title) {
      continue;
    }

    const container = link.closest('.brow-book, .book-item, .ll-book, li');
    const scope = container.length > 0 ? container : link.parent();
    const authors = scope.find('a.brow-book-author')
      .toArray()
      .map((author) => cleanText($(author).text()))
      .filter(Boolean)
      .filter((author, index, values) => values.indexOf(author) === index);

    seen.add(url);
    books.push({ title, authors, url });
  }

  return books;
}

export function extractBooksFromPages(pages) {
  const books = [];
  const seen = new Set();

  for (const page of pages) {
    for (const book of extractBooks(page.html, page.url)) {
      if (!seen.has(book.url)) {
        seen.add(book.url);
        books.push(book);
      }
    }
  }

  return books;
}

export function extractBookUrlsFromPages(pages) {
  const urls = [];
  const seen = new Set();

  for (const page of pages) {
    for (const bookUrl of extractBookUrls(page.html, page.url)) {
      if (!seen.has(bookUrl)) {
        seen.add(bookUrl);
        urls.push(bookUrl);
      }
    }
  }

  return urls;
}

export function matchBooksByLiveLibUrl(livelibBooks, existingBooks = []) {
  const existingBooksByUrl = new Map(
    existingBooks
      .filter((book) => book?.url)
      .map((book) => [book.url, book]),
  );
  const livelibUrls = new Set();
  const matched = [];
  const newBooks = [];

  for (const livelibBook of livelibBooks) {
    livelibUrls.add(livelibBook.url);
    const existingBook = existingBooksByUrl.get(livelibBook.url) ?? null;

    matched.push({
      livelibBook,
      existingBook,
    });

    if (!existingBook) {
      newBooks.push(livelibBook);
    }
  }

  const removedBooks = existingBooks.filter((book) => (
    book?.url && !livelibUrls.has(book.url)
  ));

  return {
    matched,
    newBooks,
    removedBooks,
  };
}

export function mergeExistingLiveLibBooks(livelibBooks, existingBooks = []) {
  return matchBooksByLiveLibUrl(livelibBooks, existingBooks).matched.map((match) => (
    match.existingBook ?? {
      ...match.livelibBook,
      yandex_books_urls: [],
    }
  ));
}
