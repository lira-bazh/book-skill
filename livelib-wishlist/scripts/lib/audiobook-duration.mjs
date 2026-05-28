import {
  audiobookEntriesMissingNarratorForBook,
  audiobookUrlsForBook,
  isAudiobookUrl,
  isRutrackerUrl,
  mergeAudiobookUrls,
} from './book-url-fields.mjs';
import { extractLitresAudiobookNarrator } from './litres-books.mjs';
import {
  extractRutrackerAudiobookDurationText,
  extractRutrackerAudiobookNarrator,
} from './rutracker-books.mjs';
import { extractYandexBooksAudiobookNarrator } from './yandex-books.mjs';

export { isAudiobookUrl };

const DURATION_TEXT_RE = /\d+\s*(?:час(?:а|ов)?|ч)(?:\s+\d+\s*(?:мин(?:\.|ут(?:а|ы)?)?|м))?|\d+\s*(?:мин(?:\.|ут(?:а|ы)?)?|м)/iu;
const DURATION_CLOCK_RE = /\b(\d{2}):(\d{2}):(\d{2})\b/u;

export function parseAudiobookDurationMinutes(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return null;
  }

  const clockMatch = text.match(DURATION_CLOCK_RE);
  if (clockMatch) {
    const hours = Number.parseInt(clockMatch[1], 10);
    const minutes = Number.parseInt(clockMatch[2], 10);
    const totalMinutes = hours * 60 + minutes;

    return totalMinutes > 0 ? totalMinutes : null;
  }

  let hours = 0;
  let minutes = 0;

  const hoursMatch = text.match(/(\d+)\s*(?:час(?:а|ов)?|ч)/u);
  if (hoursMatch) {
    hours = Number.parseInt(hoursMatch[1], 10);
  }

  const minutesMatch = text.match(/(\d+)\s*(?:мин(?:\.|ут(?:а|ы)?)?|м)/u);
  if (minutesMatch) {
    minutes = Number.parseInt(minutesMatch[1], 10);
  }

  const totalMinutes = hours * 60 + minutes;
  return totalMinutes > 0 ? totalMinutes : null;
}

export function firstAudiobookUrlForBook(book) {
  return audiobookUrlsForBook(book)
    .find((url) => isAudiobookUrl(url) || isRutrackerUrl(url)) ?? null;
}

export function firstAudiobookEntryMissingNarratorForBook(book) {
  return audiobookEntriesMissingNarratorForBook(book)
    .find((entry) => isAudiobookUrl(entry.url) || isRutrackerUrl(entry.url)) ?? null;
}

export function hasRecordedAudiobookDuration(book) {
  return Number.isFinite(book?.audiobook_duration_minutes);
}

export function extractAudiobookDurationMinutes(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  const rutrackerDuration = parseAudiobookDurationMinutes(
    extractRutrackerAudiobookDurationText(html),
  );
  if (rutrackerDuration !== null) {
    return rutrackerDuration;
  }

  const durationMatch = html.match(DURATION_TEXT_RE);
  return durationMatch ? parseAudiobookDurationMinutes(durationMatch[0]) : null;
}

export function extractAudiobookNarrator(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  for (const extractNarrator of [
    extractYandexBooksAudiobookNarrator,
    extractLitresAudiobookNarrator,
    extractRutrackerAudiobookNarrator,
  ]) {
    const narrator = extractNarrator(html);
    if (narrator) {
      return narrator;
    }
  }

  return null;
}

export function hasAudiobookEntriesMissingNarrator(book) {
  return firstAudiobookEntryMissingNarratorForBook(book) !== null;
}

export async function enrichBooksWithAudiobookDuration(
  books,
  {
    fetchAudiobookPage,
    pageDelayMs = 0,
    onFetchError,
    sleep = (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  } = {},
) {
  if (!Array.isArray(books)) {
    throw new Error('Books must be an array');
  }

  if (typeof fetchAudiobookPage !== 'function') {
    throw new Error('Audiobook page fetcher is required');
  }

  const enrichedBooks = [];

  for (const book of books) {
    const missingNarratorEntry = firstAudiobookEntryMissingNarratorForBook(book);
    if (hasRecordedAudiobookDuration(book) && !missingNarratorEntry) {
      enrichedBooks.push({ ...book });
      continue;
    }

    const audiobookUrl = hasRecordedAudiobookDuration(book)
      ? missingNarratorEntry?.url
      : firstAudiobookUrlForBook(book);
    if (!audiobookUrl) {
      enrichedBooks.push({ ...book });
      continue;
    }

    let durationMinutes = null;
    let narrator = null;
    try {
      const page = await fetchAudiobookPage({ url: audiobookUrl, book });
      const html = page?.html ?? '';
      durationMinutes = extractAudiobookDurationMinutes(html);
      if (missingNarratorEntry?.url === audiobookUrl) {
        narrator = extractAudiobookNarrator(html);
      }
    } catch (error) {
      if (typeof onFetchError === 'function') {
        onFetchError({ book, url: audiobookUrl, error });
      }
    }

    const nextBook = { ...book };
    if (durationMinutes !== null && !hasRecordedAudiobookDuration(nextBook)) {
      nextBook.audiobook_duration_minutes = durationMinutes;
    }
    if (narrator && missingNarratorEntry) {
      nextBook.audiobooks_urls = mergeAudiobookUrls(nextBook, [{
        url: missingNarratorEntry.url,
        narrator,
      }]);
    }

    enrichedBooks.push(nextBook);

    if (pageDelayMs > 0) {
      await sleep(pageDelayMs);
    }
  }

  return enrichedBooks;
}
