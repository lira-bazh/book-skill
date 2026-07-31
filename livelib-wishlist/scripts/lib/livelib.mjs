import { load } from "cheerio";

import { normalizeBookAudiobookUrls } from "./book-url-fields.mjs";
import { cleanText, extractHrefValues } from "./text-match.mjs";

const WISHLIST_PATH_RE = /^\/reader\/([^/]+)\/wish\/?$/;
const USER_WISHLIST_PATH_RE = /^\/users\/[0-9]+\/books\/want\/?$/;
const BOOK_ITEM_PATH_RE = /^\/(?:book|work)\/[^/]+$/;
const WISHLIST_LIST_SELECTOR =
  '[class*="CollectionPageContent_CollectionPageContentList"]';
const WISHLIST_PAGINATOR_SELECTOR =
  '[class*="CollectionPageContent_CollectionPageContentPaginatorContainer"]';
const WISHLIST_BOOK_AUTHOR_SELECTOR = '[class*="BookCard_BookCardAuthor"]';

export class LiveLibAccessError extends Error {}
export const LIVELIB_SOURCE_BOOK = Symbol("livelibSourceBook");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseLivelibWishlistUrl(rawUrl) {
  const parsed = new URL(rawUrl);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must use http or https");
  }

  if (parsed.hostname.toLowerCase() !== "www.livelib.ru") {
    throw new Error("URL host must be www.livelib.ru");
  }

  const readerMatch = parsed.pathname.match(WISHLIST_PATH_RE);
  if (readerMatch) {
    return {
      username: readerMatch[1],
      url: `https://www.livelib.ru${parsed.pathname.replace(/\/$/, "")}`
    };
  }

  const normalizedPath = parsed.pathname.replace(/\/$/, "");
  if (USER_WISHLIST_PATH_RE.test(normalizedPath) && parsed.search === "") {
    const userId = normalizedPath.split("/")[2];
    return {
      username: userId,
      url: `https://www.livelib.ru${normalizedPath}`
    };
  }

  throw new Error(
    "URL path must look like /reader/<username>/wish or /users/<id>/books/want"
  );
}

export function normalizeWishlistPageUrl(rawUrl, username, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== "www.livelib.ru") {
    return null;
  }

  const userWishlistUrl = normalizeUserWishlistPageUrl(parsed);
  if (userWishlistUrl) {
    return userWishlistUrl;
  }

  const expectedPath = `/reader/${username}/wish`;
  const normalizedPath = parsed.pathname.replace(/\/$/, "");
  const listViewMatch = normalizedPath.match(
    new RegExp(`^${escapeRegExp(expectedPath)}/listview/[^/]+/~([0-9]+)$`)
  );

  if (listViewMatch) {
    const pageValue = listViewMatch[1];
    const pageNumber = Number.parseInt(pageValue, 10);

    if (String(pageNumber) !== pageValue || pageNumber < 2 || parsed.search) {
      return null;
    }

    return `https://www.livelib.ru${normalizedPath}`;
  }

  if (normalizedPath !== expectedPath) {
    return null;
  }

  const pageValues = parsed.searchParams.getAll("page");
  const allowedParams = new Set(["page"]);
  const hasOnlyPaginationParams = [...parsed.searchParams.keys()].every(
    (name) => allowedParams.has(name)
  );

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
  const userWishlistPageNumber = getUserWishlistPageNumber(parsed);
  if (userWishlistPageNumber) {
    return userWishlistPageNumber;
  }

  const expectedPath = `/reader/${username}/wish`;
  const normalizedPath = parsed.pathname.replace(/\/$/, "");
  const listViewMatch = normalizedPath.match(
    new RegExp(`^${escapeRegExp(expectedPath)}/listview/[^/]+/~([0-9]+)$`)
  );

  if (listViewMatch) {
    return Number.parseInt(listViewMatch[1], 10);
  }

  if (normalizedPath === expectedPath) {
    return Number.parseInt(parsed.searchParams.get("page"), 10);
  }

  return null;
}

function normalizeUserWishlistPageUrl(parsed) {
  const normalizedPath = parsed.pathname.replace(/\/$/, "");
  if (
    parsed.hostname.toLowerCase() !== "www.livelib.ru" ||
    !USER_WISHLIST_PATH_RE.test(normalizedPath)
  ) {
    return null;
  }

  if (parsed.search === "") {
    return `https://www.livelib.ru${normalizedPath}`;
  }

  const pageValues = parsed.searchParams.getAll("page");
  const hasOnlyPaginationParams = [...parsed.searchParams.keys()].every(
    (name) => name === "page"
  );

  if (pageValues.length !== 1 || !hasOnlyPaginationParams) {
    return null;
  }

  const pageNumber = Number.parseInt(pageValues[0], 10);
  if (String(pageNumber) !== pageValues[0] || pageNumber < 2) {
    return null;
  }

  return `https://www.livelib.ru${normalizedPath}?page=${pageNumber}`;
}

function getUserWishlistPageNumber(parsed) {
  const normalizedPath = parsed.pathname.replace(/\/$/, "");
  if (
    parsed.hostname.toLowerCase() !== "www.livelib.ru" ||
    !USER_WISHLIST_PATH_RE.test(normalizedPath)
  ) {
    return null;
  }

  if (parsed.search === "") {
    return 1;
  }

  const pageNumber = Number.parseInt(parsed.searchParams.get("page"), 10);
  return String(pageNumber) === parsed.searchParams.get("page")
    ? pageNumber
    : null;
}

export function extractWishlistPageUrls(html, username, baseUrl) {
  const domPageUrls = extractWishlistPageUrlsFromDom(html, baseUrl);
  if (domPageUrls) {
    return uniqueWishlistPageUrls(domPageUrls, username);
  }

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

function uniqueWishlistPageUrls(pageUrls, username) {
  const urls = [];
  const seenPageNumbers = new Set();

  for (const pageUrl of pageUrls) {
    const pageNumber = getWishlistPaginationPageNumber(pageUrl, username);
    if (!seenPageNumbers.has(pageNumber)) {
      seenPageNumbers.add(pageNumber);
      urls.push(pageUrl);
    }
  }

  return urls;
}

function extractWishlistPageUrlsFromDom(html, baseUrl) {
  const $ = load(html);
  const paginator = $(WISHLIST_PAGINATOR_SELECTOR).first();
  if (paginator.length === 0) {
    return null;
  }

  const pageCount = extractWishlistDomPageCount($, paginator);
  const basePageUrl =
    normalizeUserWishlistBaseUrl(baseUrl) ??
    extractUserWishlistBaseUrlFromPaginator($, paginator, baseUrl);
  if (!basePageUrl || pageCount < 2) {
    return [];
  }

  const currentPage = getWishlistDomCurrentPageNumber(baseUrl) ?? 1;
  const urls = [];
  for (
    let pageNumber = currentPage + 1;
    pageNumber <= pageCount;
    pageNumber += 1
  ) {
    urls.push(`${basePageUrl}?page=${pageNumber}`);
  }

  return urls;
}

function extractWishlistDomPageCount($, paginator) {
  const pageNumbers = [];
  const textNumberRe = /^\d+$/u;

  paginator
    .find('a[href], button, [role="button"], span')
    .each((_, element) => {
      const text = cleanText($(element).text());
      if (textNumberRe.test(text)) {
        pageNumbers.push(Number.parseInt(text, 10));
      }

      const hrefPageNumber = getNumericSearchParam(
        $(element).attr("href"),
        "page"
      );
      if (Number.isInteger(hrefPageNumber)) {
        pageNumbers.push(hrefPageNumber);
      }
    });

  return pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1;
}

function normalizeUserWishlistBaseUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const normalizedPath = parsed.pathname.replace(/\/$/, "");
  if (
    parsed.hostname.toLowerCase() !== "www.livelib.ru" ||
    !USER_WISHLIST_PATH_RE.test(normalizedPath)
  ) {
    return null;
  }

  return `https://www.livelib.ru${normalizedPath}`;
}

function extractUserWishlistBaseUrlFromPaginator($, paginator, baseUrl) {
  for (const element of paginator.find("a[href]").toArray()) {
    let normalizedUrl;
    try {
      normalizedUrl = normalizeUserWishlistBaseUrl(
        new URL($(element).attr("href"), baseUrl).toString()
      );
    } catch {
      normalizedUrl = null;
    }
    if (normalizedUrl) {
      return normalizedUrl;
    }
  }

  return null;
}

function getWishlistDomCurrentPageNumber(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const normalizedPath = parsed.pathname.replace(/\/$/, "");
  if (
    parsed.hostname.toLowerCase() !== "www.livelib.ru" ||
    !USER_WISHLIST_PATH_RE.test(normalizedPath)
  ) {
    return null;
  }

  if (parsed.search === "") {
    return 1;
  }

  const pageNumber = Number.parseInt(parsed.searchParams.get("page"), 10);
  return String(pageNumber) === parsed.searchParams.get("page")
    ? pageNumber
    : null;
}

export function isWishlistContentUrl(rawUrl, username, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return false;
  }

  const expectedPath = `/reader/${username}/wish`;
  const normalizedPath = parsed.pathname.replace(/\/$/, "");
  if (
    parsed.hostname.toLowerCase() === "www.livelib.ru" &&
    normalizedPath === expectedPath &&
    parsed.search === ""
  ) {
    return true;
  }

  if (
    parsed.hostname.toLowerCase() === "www.livelib.ru" &&
    USER_WISHLIST_PATH_RE.test(normalizedPath) &&
    parsed.search === ""
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

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== "www.livelib.ru") {
    return null;
  }

  const normalizedPath = parsed.pathname.replace(/\/$/, "");
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
  const domBooks = extractBooksFromWishlistDom(html, baseUrl);

  return mergeWishlistBookSources(domBooks ?? []);
}

function mergeWishlistBookSources(...sources) {
  const books = [];
  const booksByUrl = new Map();

  for (const source of sources) {
    for (const book of source) {
      const existingBook = booksByUrl.get(book.url);
      if (!existingBook) {
        const nextBook = {
          title: cleanText(book.title),
          authors: uniqueBookAuthors(book.authors),
          url: book.url
        };
        booksByUrl.set(book.url, nextBook);
        books.push(nextBook);
        continue;
      }

      if (!existingBook.title) {
        existingBook.title = cleanText(book.title);
      }

      if (existingBook.authors.length === 0) {
        existingBook.authors = uniqueBookAuthors(book.authors);
      }
    }
  }

  return books;
}

function extractBooksFromWishlistDom(html, baseUrl) {
  const $ = load(html);
  const list = $(WISHLIST_LIST_SELECTOR).first();
  if (list.length === 0) {
    return null;
  }

  const books = [];
  const seen = new Set();
  const links = list
    .find("a[href]")
    .toArray()
    .filter((element) => normalizeBookUrl($(element).attr("href"), baseUrl));

  for (const element of links) {
    const link = $(element);
    const url = normalizeBookUrl(link.attr("href"), baseUrl);
    if (!url || seen.has(url)) {
      continue;
    }

    const title = cleanText(link.text());
    if (!title) {
      continue;
    }

    const authors = extractWishlistDomBookAuthors($, link);

    seen.add(url);
    books.push({ title, authors, url });
  }

  return books;
}

function extractWishlistDomBookAuthors($, bookLink) {
  return bookLink
    .parent()
    .find(WISHLIST_BOOK_AUTHOR_SELECTOR)
    .toArray()
    .flatMap((element) => cleanText($(element).text()).split(","))
    .map((author) => cleanText(author))
    .filter(Boolean)
    .filter((author, index, authors) => authors.indexOf(author) === index);
}

function uniqueBookAuthors(authors) {
  return Array.isArray(authors)
    ? authors
        .map((author) => cleanText(author))
        .filter(Boolean)
        .filter((author, index, values) => values.indexOf(author) === index)
    : [];
}

function getNumericSearchParam(rawUrl, name) {
  if (typeof rawUrl !== "string") {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl, "https://www.livelib.ru");
  } catch {
    return null;
  }

  const value = parsed.searchParams.get(name);
  const number = Number.parseInt(value, 10);

  return String(number) === value ? number : null;
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
    existingBooks.filter((book) => book?.url).map((book) => [book.url, book])
  );
  const livelibUrls = new Set();
  const matched = [];
  const newBooks = [];

  for (const livelibBook of livelibBooks) {
    livelibUrls.add(livelibBook.url);
    const existingBook = existingBooksByUrl.get(livelibBook.url) ?? null;

    matched.push({
      livelibBook,
      existingBook
    });

    if (!existingBook) {
      newBooks.push(livelibBook);
    }
  }

  const removedBooks = existingBooks.filter(
    (book) => book?.url && !livelibUrls.has(book.url)
  );

  return {
    matched,
    newBooks,
    removedBooks
  };
}

export function mergeExistingLiveLibBooks(livelibBooks, existingBooks = []) {
  return matchBooksByLiveLibUrl(livelibBooks, existingBooks).matched.map(
    (match) =>
      match.existingBook
        ? bookWithLiveLibSource(
            normalizeBookAudiobookUrls(match.existingBook),
            match.livelibBook
          )
        : {
            ...match.livelibBook,
            yandex_books_urls: [],
            audiobooks_urls: []
          }
  );
}

function bookWithLiveLibSource(existingBook, livelibBook) {
  const book = { ...existingBook };
  if (!Array.isArray(book.authors) || book.authors.length === 0) {
    book.authors = uniqueBookAuthors(livelibBook.authors);
  }

  Object.defineProperty(book, LIVELIB_SOURCE_BOOK, {
    value: livelibBook
  });

  return book;
}
