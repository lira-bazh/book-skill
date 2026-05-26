import { load } from 'cheerio';

import { cleanText, extractHrefValues } from './text-match.mjs';

const WISHLIST_PATH_RE = /^\/reader\/([^/]+)\/wish\/?$/;
const BOOK_ITEM_PATH_RE = /^\/(?:book|work)\/[^/]+$/;
const BOOK_PAGE_DESCRIPTION_SELECTOR = '.bc-about__txt';
const DESCRIPTION_SELECTOR = [
  BOOK_PAGE_DESCRIPTION_SELECTOR,
  '[itemprop="description"]',
  '.book-description',
  '.book-card-description',
  '.description',
  '.annotation',
  '[class*="description"]',
  '[class*="annotation"]',
].join(', ');
const IMAGE_SELECTOR = [
  'meta[property="og:image"]',
  'meta[name="og:image"]',
  'meta[itemprop="image"]',
  'img[itemprop="image"]',
  'img.book-cover',
  'img[class*="cover"]',
  'img[class*="book"]',
].join(', ');

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

export function extractBookPageDetails(html, baseUrl) {
  const $ = load(html);

  return {
    description: extractBookPageDescription($),
    image: extractBookPageImage($, baseUrl),
  };
}

export function hasRecordedBookPageDescription(book) {
  return typeof book?.description === 'string' && cleanText(book.description) !== '';
}

export function hasRecordedBookPageImage(book) {
  return typeof book?.image === 'string' && cleanText(book.image) !== '';
}

export function needsBookPageDetails(book) {
  return !hasRecordedBookPageDescription(book) || !hasRecordedBookPageImage(book);
}

export async function enrichBooksWithBookPageDetails(
  books,
  {
    fetchBookPage,
    pageDelayMs = 0,
    onFetchError,
    sleep = (ms) => new Promise((resolveSleep) => {
      setTimeout(resolveSleep, ms);
    }),
  } = {},
) {
  if (!Array.isArray(books)) {
    throw new Error('Books must be an array');
  }

  if (typeof fetchBookPage !== 'function') {
    throw new Error('Book page fetcher is required');
  }

  const enrichedBooks = [];

  for (const book of books) {
    if (!needsBookPageDetails(book) || !book?.url) {
      enrichedBooks.push({ ...book });
      continue;
    }

    let details = { description: null, image: null };
    try {
      const page = await fetchBookPage({ url: book.url, book });
      details = extractBookPageDetails(page?.html ?? '', page?.url ?? book.url);
    } catch (error) {
      if (typeof onFetchError === 'function') {
        onFetchError({ book, url: book.url, error });
      }
    }

    const enrichedBook = { ...book };
    if (!hasRecordedBookPageDescription(enrichedBook) && details.description) {
      enrichedBook.description = details.description;
    }
    if (!hasRecordedBookPageImage(enrichedBook) && details.image) {
      enrichedBook.image = details.image;
    }

    enrichedBooks.push(enrichedBook);

    if (pageDelayMs > 0) {
      await sleep(pageDelayMs);
    }
  }

  return enrichedBooks;
}

function extractBookPageDescription($) {
  const candidates = [
    $(BOOK_PAGE_DESCRIPTION_SELECTOR).first().text(),
    $('meta[property="og:description"]').first().attr('content'),
    $('meta[name="description"]').first().attr('content'),
    $('meta[itemprop="description"]').first().attr('content'),
    ...$(DESCRIPTION_SELECTOR).toArray().map((element) => $(element).text()),
  ];

  return candidates
    .map((value) => normalizeBookPageDescription(value))
    .find(Boolean) ?? null;
}

function normalizeBookPageDescription(value) {
  const text = cleanText(value)
    .replace(/^Описание книги\s*/i, '')
    .replace(/\s*(?:Читать полностью|Свернуть)\s*$/i, '')
    .trim();

  return text || null;
}

function extractBookPageImage($, baseUrl) {
  for (const element of $(IMAGE_SELECTOR).toArray()) {
    const image = $(element);
    const rawUrl = image.attr('content')
      ?? image.attr('src')
      ?? image.attr('data-src')
      ?? image.attr('data-original')
      ?? image.attr('data-lazy-src');
    const normalizedUrl = normalizeBookPageImageUrl(rawUrl, baseUrl);

    if (normalizedUrl) {
      return normalizedUrl;
    }
  }

  return null;
}

function normalizeBookPageImageUrl(rawUrl, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  return parsed.toString();
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
