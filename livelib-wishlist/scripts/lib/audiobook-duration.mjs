import { load } from 'cheerio';
import {
  audiobookUrlsForBook,
  isAudiobookUrl,
} from './book-url-fields.mjs';

export { isAudiobookUrl };

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
  return audiobookUrlsForBook(book).find((url) => isAudiobookUrl(url)) ?? null;
}

export function hasRecordedAudiobookDuration(book) {
  return Number.isFinite(book?.audiobook_duration_minutes);
}

export function extractAudiobookDurationMinutes(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  const $ = load(html);
  const text = $('body').text();
  const durationMatch = text.match(
    /\d+\s*(?:час(?:а|ов)?|ч)(?:\s+\d+\s*(?:мин(?:\.|ут(?:а|ы)?)?|м))?|\d+\s*(?:мин(?:\.|ут(?:а|ы)?)?|м)/iu,
  );

  return durationMatch ? parseAudiobookDurationMinutes(durationMatch[0]) : null;
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
    if (hasRecordedAudiobookDuration(book)) {
      enrichedBooks.push({ ...book });
      continue;
    }

    const audiobookUrl = firstAudiobookUrlForBook(book);
    if (!audiobookUrl) {
      enrichedBooks.push({ ...book });
      continue;
    }

    let durationMinutes = null;
    try {
      const page = await fetchAudiobookPage({ url: audiobookUrl, book });
      durationMinutes = extractAudiobookDurationMinutes(page?.html ?? '');
    } catch (error) {
      if (typeof onFetchError === 'function') {
        onFetchError({ book, url: audiobookUrl, error });
      }
    }

    enrichedBooks.push(
      durationMinutes === null
        ? { ...book }
        : { ...book, audiobook_duration_minutes: durationMinutes },
    );

    if (pageDelayMs > 0) {
      await sleep(pageDelayMs);
    }
  }

  return enrichedBooks;
}
