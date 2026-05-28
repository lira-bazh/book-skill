import { load } from "cheerio";

import { buildBookSearchQuery } from "./book-search-query.mjs";
import { mergeAudiobookUrls } from "./book-url-fields.mjs";
import { cleanText, normalizeForMatch } from "./text-match.mjs";

const RUTRACKER_HOSTNAME = "rutracker.org";
const RUTRACKER_BASE_URL = `https://${RUTRACKER_HOSTNAME}/forum/`;

export function buildRutrackerSearchQuery(book) {
  return buildBookSearchQuery(book);
}

export function buildRutrackerSearchUrl(query) {
  const normalizedQuery = cleanText(query);
  if (!normalizedQuery) {
    throw new Error("RuTracker search query must not be empty");
  }

  const url = new URL("tracker.php", RUTRACKER_BASE_URL);
  url.searchParams.set("nm", normalizedQuery);
  return url.toString();
}

export function normalizeRutrackerUrl(rawUrl, baseUrl = RUTRACKER_BASE_URL) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== RUTRACKER_HOSTNAME) {
    return null;
  }

  if (
    parsed.pathname !== "/forum/viewtopic.php" ||
    !parsed.searchParams.has("t")
  ) {
    return null;
  }

  const topicId = cleanText(parsed.searchParams.get("t"));
  if (!/^\d+$/u.test(topicId)) {
    return null;
  }

  return `https://${RUTRACKER_HOSTNAME}/forum/viewtopic.php?t=${topicId}`;
}

export function extractRutrackerSearchResults(
  html,
  baseUrl = RUTRACKER_BASE_URL
) {
  const $ = load(html);
  const results = [];
  const seen = new Set();

  $(".t-title-col").each((_, element) => {
    const cell = $(element);
    const topicLink = cell
      .find('a[href*="viewtopic.php"]')
      .toArray()
      .find((linkElement) =>
        normalizeRutrackerUrl($(linkElement).attr("href"), baseUrl)
      );

    if (!topicLink) {
      return;
    }

    const url = normalizeRutrackerUrl($(topicLink).attr("href"), baseUrl);
    if (!url || seen.has(url)) {
      return;
    }

    const title = cleanText(cell.text());
    if (!title) {
      return;
    }

    seen.add(url);
    results.push({ title, url });
  });

  return results;
}

export function filterRutrackerResultsForQuery(
  results,
  query,
  { maxResults = Infinity } = {}
) {
  const queryTokens = normalizedWords(query);
  const filtered = [];
  const seen = new Set();

  if (queryTokens.length === 0) {
    return filtered;
  }

  for (const result of results) {
    if (filtered.length >= maxResults) {
      break;
    }

    if (!result?.url || seen.has(result.url)) {
      continue;
    }

    const titleTokens = new Set(normalizedWords(result.title));
    const hasAllQueryTokens = queryTokens.every((token) =>
      titleTokens.has(token)
    );
    const hasKbps = titleTokens.has("kbps");

    if (hasAllQueryTokens && hasKbps) {
      seen.add(result.url);
      filtered.push(result);
    }
  }

  return filtered;
}

function normalizedWords(value) {
  return normalizeForMatch(value).split(" ").filter(Boolean);
}

export function extractMatchingRutrackerUrls(
  html,
  query,
  baseUrl = RUTRACKER_BASE_URL,
  options = {}
) {
  return filterRutrackerResultsForQuery(
    extractRutrackerSearchResults(html, baseUrl),
    query,
    options
  ).map((result) => result.url);
}

function existingRutrackerUrlsForBook(book, existingBooksByUrl) {
  const existingBook = existingBooksByUrl.get(book?.url);
  const urls = [
    ...(Array.isArray(existingBook?.rutracker_urls) ? existingBook.rutracker_urls : []),
    ...(Array.isArray(existingBook?.audiobooks_urls)
      ? existingBook.audiobooks_urls.filter((url) => url.includes("rutracker.org/"))
      : []),
  ];
  if (
    urls.length === 0
  ) {
    return null;
  }

  return urls;
}

export function countBooksWithExistingRutrackerUrls(books, existingBooks = []) {
  const existingBooksByUrl = new Map(
    existingBooks.filter((book) => book?.url).map((book) => [book.url, book])
  );

  return books.filter((book) =>
    existingRutrackerUrlsForBook(book, existingBooksByUrl)
  ).length;
}

export async function enrichBooksWithRutrackerUrls(
  books,
  {
    existingBooks = [],
    fetchSearchPage,
    profileDir,
    maxResults = Infinity,
    delayMs = 0,
    onSearchError,
    sleep = defaultSleep
  } = {}
) {
  if (typeof fetchSearchPage !== "function") {
    throw new Error("RuTracker search page fetcher is required");
  }

  const existingBooksByUrl = new Map(
    existingBooks.filter((book) => book?.url).map((book) => [book.url, book])
  );
  const enrichedBooks = [];

  for (const book of books) {
    const { rutracker_urls: _legacyRutrackerUrls, ...bookWithoutRutrackerUrls } = book;
    const existingRutrackerUrls = existingRutrackerUrlsForBook(
      book,
      existingBooksByUrl
    );
    if (existingRutrackerUrls) {
      enrichedBooks.push({
        ...bookWithoutRutrackerUrls,
        audiobooks_urls: mergeAudiobookUrls(book, existingRutrackerUrls)
      });
      continue;
    }

    const query = buildRutrackerSearchQuery(book);
    if (!query) {
      enrichedBooks.push({
        ...bookWithoutRutrackerUrls,
        audiobooks_urls: mergeAudiobookUrls(book, [])
      });
      continue;
    }

    const searchUrl = buildRutrackerSearchUrl(query);

    try {
      const searchPage = await fetchSearchPage({
        book,
        query,
        searchUrl,
        profileDir
      });
      const rutrackerUrls = extractMatchingRutrackerUrls(
        searchPage?.html ?? "",
        query,
        searchPage?.url ?? searchUrl,
        { maxResults }
      );

      enrichedBooks.push({
        ...bookWithoutRutrackerUrls,
        audiobooks_urls: mergeAudiobookUrls(book, rutrackerUrls)
      });
    } catch (error) {
      if (typeof onSearchError === "function") {
        onSearchError({ book, error });
      }
      enrichedBooks.push({
        ...bookWithoutRutrackerUrls,
        audiobooks_urls: mergeAudiobookUrls(book, [])
      });
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return enrichedBooks;
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
