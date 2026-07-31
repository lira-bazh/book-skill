import { load } from "cheerio";

import { cleanText } from "./text-match.mjs";

const IMAGE_SELECTOR = [
  'img[class*="Cover_CoverImage"]',
  '[class*="Cover_CoverImage"] img',
  'link[rel="preload"][as="image"][href*="/boocover/"]',
  'meta[property="og:image"]',
  'meta[name="twitter:image"]'
].join(", ");
const GENRE_SELECTOR = ".bc-info__item";

export function extractBookPageDetails(html, baseUrl) {
  const $ = load(html);

  return {
    image: extractBookPageImage($, baseUrl),
    genre: extractBookPageGenre($)
  };
}

export function hasRecordedBookPageDescription(book) {
  return (
    typeof book?.description === "string" && cleanText(book.description) !== ""
  );
}

export function hasRecordedBookPageImage(book) {
  return typeof book?.image === "string" && cleanText(book.image) !== "";
}

export function hasRecordedBookPageGenre(book) {
  return Boolean(book) && Object.prototype.hasOwnProperty.call(book, "genre");
}

export function needsBookPageDetails(book) {
  return !hasRecordedBookPageImage(book) || !hasRecordedBookPageGenre(book);
}

export async function enrichBooksWithBookPageDetails(
  books,
  {
    fetchBookPage,
    pageDelayMs = 0,
    onFetchError,
    sleep = (ms) =>
      new Promise((resolveSleep) => {
        setTimeout(resolveSleep, ms);
      })
  } = {}
) {
  if (!Array.isArray(books)) {
    throw new Error("Books must be an array");
  }

  if (typeof fetchBookPage !== "function") {
    throw new Error("Book page fetcher is required");
  }

  const enrichedBooks = [];

  for (const book of books) {
    if (!needsBookPageDetails(book) || !book?.url) {
      enrichedBooks.push({ ...book });
      continue;
    }

    let details = { image: null, genre: null };
    try {
      const page = await fetchBookPage({ url: book.url, book });
      details = extractBookPageDetails(page?.html ?? "", page?.url ?? book.url);
    } catch (error) {
      if (typeof onFetchError === "function") {
        onFetchError({ book, url: book.url, error });
      }
    }

    const enrichedBook = { ...book };
    if (!hasRecordedBookPageImage(enrichedBook) && details.image) {
      enrichedBook.image = details.image;
    }
    if (!hasRecordedBookPageGenre(enrichedBook)) {
      enrichedBook.genre = details.genre;
    }

    enrichedBooks.push(enrichedBook);

    if (pageDelayMs > 0) {
      await sleep(pageDelayMs);
    }
  }

  return enrichedBooks;
}

function extractBookPageImage($, baseUrl) {
  const bookId = extractBookPageId(baseUrl);
  const imageUrls = [];

  for (const element of $(IMAGE_SELECTOR).toArray()) {
    const image = $(element);
    const rawUrl = firstBookPageImageUrlCandidate(image);
    const normalizedUrl = normalizeBookPageImageUrl(rawUrl, baseUrl);

    if (normalizedUrl) {
      imageUrls.push(normalizedUrl);
    }
  }

  return imageUrls.find((url) => isBookPageCoverImageUrlForBook(url, bookId))
    ?? imageUrls[0]
    ?? null;
}

function firstBookPageImageUrlCandidate(image) {
  return (
    image.attr("content") ??
    image.attr("href") ??
    image.attr("data-src") ??
    image.attr("data-original") ??
    image.attr("data-lazy-src") ??
    firstSrcsetUrl(image.attr("data-srcset")) ??
    firstSrcsetUrl(image.attr("srcset")) ??
    image.attr("src")
  );
}

function firstSrcsetUrl(value) {
  const firstCandidate = cleanText(value).split(",")[0];
  return cleanText(firstCandidate).split(/\s+/u)[0] || null;
}

function normalizeBookPageImageUrl(rawUrl, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return null;
  }

  return parsed.toString();
}

function extractBookPageId(baseUrl) {
  try {
    return new URL(baseUrl).pathname.match(/^\/book\/(\d+)/u)?.[1] ?? null;
  } catch {
    return null;
  }
}

function isBookPageCoverImageUrlForBook(rawUrl, bookId) {
  if (!bookId) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    return url.pathname.includes(`/boocover/${bookId}/`);
  } catch {
    return false;
  }
}

function extractBookPageGenre($) {
  const text = $(GENRE_SELECTOR)
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean)
    .join(" ");

  return normalizeBookPageGenre(text);
}

function normalizeBookPageGenre(value) {
  const text = cleanText(value).toLowerCase();

  if (text.includes("научно-популярная литература")) {
    return "научпоп";
  }

  if (text.includes("фантастика")) {
    return "фантастика";
  }

  if (text.includes("фэнтези")) {
    return "фэнтези";
  }

  return null;
}
