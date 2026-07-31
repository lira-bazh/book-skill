import { load } from "cheerio";

import { extractLabeledPageTextValue } from "./audiobook-page-fields.mjs";
import { buildBookSearchQuery } from "./book-search-query.mjs";
import { isRutrackerUrl, mergeAudiobookUrls } from "./book-url-fields.mjs";
import { cleanText, normalizeForMatch, stripParentheticalText } from "./text-match.mjs";

const RUTRACKER_HOSTNAME = "rutracker.org";
const RUTRACKER_BASE_URL = `https://${RUTRACKER_HOSTNAME}/forum/`;
const RUTRACKER_AUTHOR_LABELS = ["Автор", "Авторы"];
const RUTRACKER_TITLE_LABELS = ["Название", "Наименование"];
const RUTRACKER_DURATION_LABELS = ["Время звучания", "Продолжительность"];
const RUTRACKER_NARRATOR_LABELS = [
  "Исполнитель (рассказчик)",
  "Исполнитель",
  "Рассказчик",
  "Чтец",
  "Читает"
];
const RUTRACKER_DURATION_TIME_RE = /\b\d{2}:\d{2}:\d{2}\b/u;
const RUTRACKER_EXCLUDED_SEARCH_ROW_RE =
  /аудиокниги\s+на\s+(?:английском\s+языке|других\s+иностранных\s+языках)/iu;
const RUTRACKER_AUDIO_FORMAT_RE = /^(?:mp3|m4b|aac|flac|ogg|wma|wav)\b/iu;
const AUTHOR_ET_AL_RE = /(?:^|[\s,;])и\s+др\.?$/iu;
const AUTHOR_SEPARATOR_RE = /\s*(?:[,;]|\s+[&+]\s+)\s*/u;
const TITLE_MATCH_STOP_RE = /[.:?]/u;

export function extractRutrackerAudiobookTitle(html) {
  const firstPostHtml = extractRutrackerFirstTopicPostHtml(html);
  if (!firstPostHtml) {
    return null;
  }

  const stopLabels = [
    ...RUTRACKER_AUTHOR_LABELS,
    ...RUTRACKER_TITLE_LABELS,
    ...RUTRACKER_NARRATOR_LABELS,
    ...RUTRACKER_DURATION_LABELS,
  ];
  const author = extractLabeledPageTextValue(
    firstPostHtml,
    RUTRACKER_AUTHOR_LABELS,
    { stopLabels }
  );
  const title = extractLabeledPageTextValue(firstPostHtml, RUTRACKER_TITLE_LABELS, {
    stopLabels,
  });

  return normalizeRutrackerAudiobookTitleWithAuthor(author, title)
    ?? extractRutrackerAudiobookTitleFromPostHeading(firstPostHtml);
}

export function extractRutrackerAudiobookDurationText(html) {
  const firstPostHtml = extractRutrackerFirstTopicPostHtml(html);
  if (!firstPostHtml) {
    return null;
  }

  return extractRutrackerDurationTimeAfterLabel(firstPostHtml)
    ?? extractLabeledPageTextValue(firstPostHtml, RUTRACKER_DURATION_LABELS, {
      stopLabels: [...RUTRACKER_DURATION_LABELS, ...RUTRACKER_NARRATOR_LABELS]
    });
}

export function extractRutrackerAudiobookNarrator(html) {
  const firstPostHtml = extractRutrackerFirstTopicPostHtml(html);
  if (!firstPostHtml) {
    return null;
  }

  return extractRutrackerAudiobookNarratorFromPostBody(firstPostHtml)
    ?? (
      isRutrackerTopicHtml(firstPostHtml)
        ? extractLabeledPageTextValue(firstPostHtml, RUTRACKER_NARRATOR_LABELS, {
          stopLabels: [...RUTRACKER_NARRATOR_LABELS, ...RUTRACKER_DURATION_LABELS]
        })
        : null
    );
}

function extractRutrackerFirstTopicPostHtml(html) {
  if (typeof html !== "string" || !html.trim()) {
    return null;
  }

  const $ = load(html);
  const firstPost = $('#topic_main tbody[id^="post_"]').first();
  if (firstPost.length === 0) {
    return null;
  }

  return $.html(firstPost);
}

function extractRutrackerDurationTimeAfterLabel(html) {
  if (typeof html !== "string" || !html.trim()) {
    return null;
  }

  const text = load(html)("body").text();
  const labelIndex = RUTRACKER_DURATION_LABELS
    .map((label) => text.indexOf(label))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0] ?? -1;
  if (labelIndex === -1) {
    return null;
  }

  return text.slice(labelIndex).match(RUTRACKER_DURATION_TIME_RE)?.[0] ?? null;
}

function normalizeRutrackerAudiobookTitle(value) {
  return cleanText(value) || null;
}

function normalizeRutrackerAudiobookTitleWithAuthor(author, title) {
  const normalizedTitle = normalizeRutrackerAudiobookTitle(title);
  if (!normalizedTitle) {
    return null;
  }

  const normalizedAuthor = cleanText(author);
  if (!normalizedAuthor) {
    return normalizedTitle;
  }

  const titleForMatch = normalizeForMatch(normalizedTitle);
  const authorForMatch = normalizeForMatch(normalizedAuthor);
  if (titleForMatch.includes(authorForMatch)) {
    return normalizedTitle;
  }

  return `${normalizedAuthor} - ${normalizedTitle}`;
}

function extractRutrackerAudiobookTitleFromPostHeading(html) {
  if (typeof html !== "string" || !html.trim()) {
    return null;
  }

  const $ = load(html);
  const firstPost = $(".post_body").first();
  if (firstPost.length === 0) {
    return null;
  }

  const parts = [];
  for (const child of firstPost.contents().toArray()) {
    const node = $(child);
    if (child.type === "tag" && (child.name === "br" || node.hasClass("post-br"))) {
      break;
    }

    const text = cleanText(node.text());
    if (text) {
      parts.push(text);
    }
  }

  return normalizeRutrackerAudiobookTitle(parts.join(" "));
}

function isRutrackerTopicHtml(html) {
  if (typeof html !== "string" || !html.trim()) {
    return false;
  }

  const $ = load(html);
  return $(".post_body").length > 0;
}

function extractRutrackerAudiobookNarratorFromPostBody(html) {
  if (typeof html !== "string" || !html.trim()) {
    return null;
  }

  const $ = load(html);
  const firstPost = $(".post_body").first();
  if (firstPost.length === 0) {
    return null;
  }

  const label = firstPost
    .find(".post-b")
    .toArray()
    .find((element) =>
      RUTRACKER_NARRATOR_LABELS.includes(cleanText($(element).text()).replace(/:$/u, ""))
    );
  if (!label) {
    return null;
  }

  const parts = [];
  let sibling = label.nextSibling;
  while (sibling) {
    const node = $(sibling);
    if (sibling.type === "tag" && sibling.name === "br") {
      break;
    }
    if (sibling.type === "tag" && node.hasClass("post-b")) {
      break;
    }

    parts.push(node.text());
    sibling = sibling.nextSibling;
  }

  return cleanText(parts.join(" ").replace(/^:/u, "")) || null;
}

export function buildRutrackerSearchQuery(book) {
  return buildBookSearchQuery(book);
}

export function buildRutrackerSearchUrl(
  query,
  {
    baseUrl = RUTRACKER_BASE_URL
  } = {}
) {
  const normalizedQuery = cleanText(query);
  if (!normalizedQuery) {
    throw new Error("RuTracker search query must not be empty");
  }

  const url = new URL("/forum/tracker.php", baseUrl);
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

export function extractRutrackerSearchResultsFromHtml(html, baseUrl = RUTRACKER_BASE_URL) {
  const $ = load(html);
  const results = [];
  const seen = new Set();

  for (const element of $('a[href*="viewtopic.php?t="]').toArray()) {
    const link = $(element);
    const url = normalizeRutrackerUrl(link.attr("href"), baseUrl);
    const title = cleanText(link.text());
    if (!url || !title || seen.has(url)) {
      continue;
    }

    const rowText = cleanText(link.closest("tr").text());
    if (isExcludedRutrackerSearchRow(rowText || title)) {
      continue;
    }

    seen.add(url);
    results.push({
      title,
      url,
      narrator: extractRutrackerNarratorFromBracketsText(title)
    });
  }

  return results;
}

function isExcludedRutrackerSearchRow(rowText) {
  return RUTRACKER_EXCLUDED_SEARCH_ROW_RE.test(rowText);
}

export function extractRutrackerNarratorFromBracketsText(value) {
  const text = cleanText(value);
  if (!text) {
    return null;
  }

  for (const match of text.matchAll(/\[\s*\[?\s*([^\],]+?)(?:\s*\]|\s*,)/gu)) {
    const narrator = cleanText(match[1]);
    if (narrator && !RUTRACKER_AUDIO_FORMAT_RE.test(narrator)) {
      return narrator;
    }
  }

  return null;
}

export function filterRutrackerResultsForBook(
  results,
  book,
  { maxResults = Infinity } = {}
) {
  const titleTokens = normalizedBookTitleWords(book);
  const authorTokens = authorLastNameWords(book?.authors);
  const filtered = [];
  const seen = new Set();

  if (titleTokens.length === 0) {
    return filtered;
  }

  for (const result of results) {
    if (filtered.length >= maxResults) {
      break;
    }

    if (!result?.url || seen.has(result.url)) {
      continue;
    }

    const resultTokens = new Set(normalizedWords(result.title));
    const hasAllTitleTokens = titleTokens.every((token) =>
      resultTokens.has(token)
    );
    const hasAuthorLastName = authorTokens.length === 0 ||
      authorTokens.some((token) => resultTokens.has(token));
    const hasKbps = resultTokens.has("kbps");

    if (hasAllTitleTokens && hasAuthorLastName && hasKbps) {
      seen.add(result.url);
      filtered.push(result);
    }
  }

  return filtered;
}

function normalizedWords(value) {
  return normalizeForMatch(value).split(" ").filter(Boolean);
}

function normalizedBookTitleWords(book) {
  const title = cleanText(
    stripParentheticalText(book?.title).split(TITLE_MATCH_STOP_RE, 1)[0]
  );
  return normalizedWords(title);
}

function authorLastNameWords(authors) {
  if (!Array.isArray(authors)) {
    return [];
  }

  return authors
    .flatMap((author) =>
      cleanText(author).replace(AUTHOR_ET_AL_RE, "").split(AUTHOR_SEPARATOR_RE)
    )
    .map((author) => normalizedWords(author).at(-1))
    .filter(Boolean);
}

function extractRutrackerAudiobookEntriesFromSearchPage(
  searchPage,
  book,
  options
) {
  if (typeof searchPage?.html !== "string") {
    return [];
  }

  return filterRutrackerResultsForBook(
    extractRutrackerSearchResultsFromHtml(searchPage.html, searchPage.url),
    book,
    options
  ).map((result) => ({
    url: result.url,
    narrator: result.narrator ?? null
  }));
}

export async function fetchRutrackerSearchPage({
  query,
  searchUrl,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API is not available for RuTracker search");
  }

  const normalizedQuery = cleanText(query);
  const targetUrl = searchUrl ?? buildRutrackerSearchUrl(normalizedQuery);
  const response = await fetchImpl(targetUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response?.ok) {
    throw new Error(`RuTracker search failed with HTTP status ${response?.status ?? "unknown"}`);
  }

  return {
    query: normalizedQuery,
    url: targetUrl,
    html: await response.text()
  };
}

function existingRutrackerUrlsForBook(book, existingBooksByUrl) {
  const existingBook = existingBooksByUrl.get(book?.url);
  const urls = [
    ...(Array.isArray(book?.audiobooks_urls)
      ? book.audiobooks_urls.filter((url) => isRutrackerUrl(url))
      : []),
    ...(Array.isArray(existingBook?.rutracker_urls) ? existingBook.rutracker_urls : []),
    ...(Array.isArray(existingBook?.audiobooks_urls)
      ? existingBook.audiobooks_urls.filter((url) => isRutrackerUrl(url))
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
      const rutrackerUrls = extractRutrackerAudiobookEntriesFromSearchPage(
        searchPage,
        book,
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
