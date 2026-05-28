import { cleanText } from './text-match.mjs';

export function audiobookEntryUrl(entry) {
  if (typeof entry === 'string') {
    return entry;
  }

  return typeof entry?.url === 'string' ? entry.url : null;
}

export function normalizeAudiobookEntry(entry) {
  const url = cleanText(audiobookEntryUrl(entry));
  if (!url) {
    return null;
  }

  const narrator = cleanText(entry?.narrator);
  return {
    url,
    narrator: narrator || null,
  };
}

export function isAudiobookUrl(rawUrl) {
  const url = audiobookEntryUrl(rawUrl);
  return typeof url === 'string' && url.toLowerCase().includes('audiobook');
}

export function isRutrackerUrl(rawUrl) {
  const url = audiobookEntryUrl(rawUrl);
  if (typeof url !== 'string') {
    return false;
  }

  try {
    return new URL(url).hostname.toLowerCase().endsWith('rutracker.org');
  } catch {
    return url.toLowerCase().includes('rutracker.org/');
  }
}

export function uniqueUrls(urls) {
  const seen = new Set();
  const result = [];

  for (const url of urls) {
    if (typeof url !== 'string' || seen.has(url)) {
      continue;
    }
    seen.add(url);
    result.push(url);
  }

  return result;
}

export function uniqueAudiobookEntries(entries) {
  const byUrl = new Map();

  for (const entry of entries) {
    const normalizedEntry = normalizeAudiobookEntry(entry);
    if (!normalizedEntry) {
      continue;
    }

    const existingEntry = byUrl.get(normalizedEntry.url);
    if (!existingEntry) {
      byUrl.set(normalizedEntry.url, normalizedEntry);
      continue;
    }

    if (!existingEntry.narrator && normalizedEntry.narrator) {
      byUrl.set(normalizedEntry.url, normalizedEntry);
    }
  }

  return [...byUrl.values()];
}

export function splitAudiobookUrls(urls) {
  const regularUrls = [];
  const audiobookUrls = [];

  for (const url of Array.isArray(urls) ? urls : []) {
    if (isAudiobookUrl(url) || isRutrackerUrl(url)) {
      audiobookUrls.push(url);
    } else {
      regularUrls.push(url);
    }
  }

  return {
    regularUrls: uniqueUrls(regularUrls),
    audiobookUrls: uniqueAudiobookEntries(audiobookUrls),
  };
}

export function mergeAudiobookUrls(book, urls) {
  return uniqueAudiobookEntries([
    ...(Array.isArray(book?.audiobooks_urls) ? book.audiobooks_urls : []),
    ...urls,
  ]);
}

export function audiobookEntriesForBook(book) {
  return uniqueAudiobookEntries([
    ...(Array.isArray(book?.audiobooks_urls) ? book.audiobooks_urls : []),
    ...splitAudiobookUrls(book?.yandex_books_urls).audiobookUrls,
    ...splitAudiobookUrls(book?.litres_urls).audiobookUrls,
    ...(Array.isArray(book?.rutracker_urls) ? book.rutracker_urls : []),
  ]);
}

export function audiobookUrlsForBook(book) {
  return audiobookEntriesForBook(book).map((entry) => entry.url);
}

export function audiobookEntriesMissingNarratorForBook(book) {
  return audiobookEntriesForBook(book).filter((entry) => !entry.narrator);
}

export function normalizeBookAudiobookUrls(book) {
  if (!book || typeof book !== 'object') {
    return book;
  }

  if (!Array.isArray(book.audiobooks_urls)) {
    return book;
  }

  return {
    ...book,
    audiobooks_urls: uniqueAudiobookEntries(book.audiobooks_urls),
  };
}
