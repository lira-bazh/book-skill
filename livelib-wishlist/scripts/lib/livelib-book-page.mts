import { load, type CheerioAPI } from "cheerio";

import { cleanText } from "./text-match.mjs";

type BookPageDetails = {
  image: string | null;
  genre: string | null;
};

type BookPageBook = {
  url?: string | null;
  description?: unknown;
  image?: unknown;
  genre?: unknown;
  [key: string]: unknown;
} | null | undefined;

type FetchedBookPage = {
  url?: string | null;
  html?: string | null;
} | null | undefined;

type FetchBookPage = (options: {
  url: string;
  book: BookPageBook;
}) => Promise<FetchedBookPage> | FetchedBookPage;

type EnrichBooksWithBookPageDetailsOptions = {
  fetchBookPage?: FetchBookPage;
  pageDelayMs?: number;
  onFetchError?: (details: {
    book: BookPageBook;
    url: string;
    error: unknown;
  }) => void;
  sleep?: (ms: number) => Promise<unknown>;
};

type EnrichedBookPageBook = Record<string, unknown> & {
  image?: unknown;
  genre?: unknown;
};

type CheerioSelection = ReturnType<CheerioAPI>;

const IMAGE_SELECTOR = [
  'img[class*="Cover_CoverImage"]',
  '[class*="Cover_CoverImage"] img',
  'link[rel="preload"][as="image"][href*="/boocover/"]',
  'meta[property="og:image"]',
  'meta[name="twitter:image"]'
].join(", ");
const GENRE_SELECTOR = ".bc-info__item";

export function extractBookPageDetails(html: string, baseUrl: string): BookPageDetails {
  const $ = load(html);

  return {
    image: extractBookPageImage($, baseUrl),
    genre: extractBookPageGenre($)
  };
}

export function hasRecordedBookPageDescription(book: BookPageBook): boolean {
  return (
    typeof book?.description === "string" && cleanText(book.description) !== ""
  );
}

export function hasRecordedBookPageImage(book: BookPageBook): boolean {
  return typeof book?.image === "string" && cleanText(book.image) !== "";
}

export function hasRecordedBookPageGenre(book: BookPageBook): boolean {
  return Boolean(book) && Object.prototype.hasOwnProperty.call(book, "genre");
}

export function needsBookPageDetails(book: BookPageBook): boolean {
  return !hasRecordedBookPageImage(book) || !hasRecordedBookPageGenre(book);
}

export async function enrichBooksWithBookPageDetails(
  books: readonly BookPageBook[],
  {
    fetchBookPage,
    pageDelayMs = 0,
    onFetchError,
    sleep = (ms) =>
      new Promise((resolveSleep) => {
        setTimeout(resolveSleep, ms);
      })
  }: EnrichBooksWithBookPageDetailsOptions = {}
): Promise<EnrichedBookPageBook[]> {
  if (!Array.isArray(books)) {
    throw new Error("Books must be an array");
  }

  if (typeof fetchBookPage !== "function") {
    throw new Error("Book page fetcher is required");
  }

  const enrichedBooks: EnrichedBookPageBook[] = [];

  for (const book of books) {
    if (!needsBookPageDetails(book) || !book?.url) {
      enrichedBooks.push(copyBook(book));
      continue;
    }

    let details: BookPageDetails = { image: null, genre: null };
    try {
      const page = await fetchBookPage({ url: book.url, book });
      details = extractBookPageDetails(page?.html ?? "", page?.url ?? book.url);
    } catch (error) {
      if (typeof onFetchError === "function") {
        onFetchError({ book, url: book.url, error });
      }
    }

    const enrichedBook = copyBook(book);
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

function copyBook(book: BookPageBook): EnrichedBookPageBook {
  return typeof book === "object" && book !== null ? { ...book } : {};
}

function extractBookPageImage($: CheerioAPI, baseUrl: string): string | null {
  const bookId = extractBookPageId(baseUrl);
  const imageUrls: string[] = [];

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

function firstBookPageImageUrlCandidate(image: CheerioSelection): string | undefined | null {
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

function firstSrcsetUrl(value: unknown): string | null {
  const firstCandidate = cleanText(value).split(",")[0];
  return cleanText(firstCandidate).split(/\s+/u)[0] || null;
}

function normalizeBookPageImageUrl(rawUrl: string | null | undefined, baseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl ?? "", baseUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return null;
  }

  return parsed.toString();
}

function extractBookPageId(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).pathname.match(/^\/book\/(\d+)/u)?.[1] ?? null;
  } catch {
    return null;
  }
}

function isBookPageCoverImageUrlForBook(rawUrl: string, bookId: string | null): boolean {
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

function extractBookPageGenre($: CheerioAPI): string | null {
  const text = $(GENRE_SELECTOR)
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean)
    .join(" ");

  return normalizeBookPageGenre(text);
}

function normalizeBookPageGenre(value: unknown): string | null {
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
