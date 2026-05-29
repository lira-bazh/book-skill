import {
  audiobookEntriesForBook,
  audiobookEntriesMissingNarratorForBook,
  audiobookUrlsForBook,
  isAudiobookUrl,
  isRutrackerUrl,
  mergeAudiobookUrls,
} from './book-url-fields.mjs';
import {
  extractLitresAudiobookDurationMinutes,
  extractLitresAudiobookNarrator,
} from './litres-books.mjs';
import {
  extractRutrackerAudiobookDurationText,
  extractRutrackerAudiobookNarrator,
  extractRutrackerAudiobookTitle,
} from './rutracker-books.mjs';
import {
  extractYandexBooksAudiobookDurationMinutes,
  extractYandexBooksAudiobookNarrator,
} from './yandex-books.mjs';

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

export function hasRecordedAudiobookEntryDuration(entry) {
  return Number.isFinite(entry?.duration);
}

export function audiobookEntriesMissingDurationForBook(book) {
  return audiobookEntriesForBook(book)
    .filter((entry) => (
      (isAudiobookUrl(entry.url) || isRutrackerUrl(entry.url))
      && !hasRecordedAudiobookEntryDuration(entry)
    ));
}

export function averageAudiobookEntryDurationMinutesForBook(book) {
  const durations = audiobookEntriesForBook(book)
    .map((entry) => entry.duration)
    .filter(Number.isFinite);

  if (durations.length === 0) {
    return null;
  }

  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  return Math.round(totalDuration / durations.length);
}

export function withAverageAudiobookDuration(book) {
  const averageDuration = averageAudiobookEntryDurationMinutesForBook(book);
  if (averageDuration === null) {
    return book;
  }

  return {
    ...book,
    audiobook_duration_minutes: averageDuration,
  };
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

  const litresDuration = extractLitresAudiobookDurationMinutes(html);
  if (litresDuration !== null) {
    return litresDuration;
  }

  const yandexBooksDuration = extractYandexBooksAudiobookDurationMinutes(html);
  if (yandexBooksDuration !== null) {
    return yandexBooksDuration;
  }

  const durationMatch = html.match(DURATION_TEXT_RE);
  return durationMatch ? parseAudiobookDurationMinutes(durationMatch[0]) : null;
}

export function extractAudiobookNarrator(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  for (const extractNarrator of [
    extractRutrackerAudiobookNarrator,
    extractYandexBooksAudiobookNarrator,
    extractLitresAudiobookNarrator,
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

export function hasAudiobookEntriesMissingDuration(book) {
  return audiobookEntriesMissingDurationForBook(book).length > 0;
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
    const audiobookEntries = audiobookEntriesForBook(book)
      .filter((entry) => isAudiobookUrl(entry.url) || isRutrackerUrl(entry.url));
    const entriesToFetch = audiobookEntries
      .filter((entry) => (
        !hasRecordedAudiobookEntryDuration(entry)
        || !entry.narrator
        || (isRutrackerUrl(entry.url) && !entry.title)
      ));

    if (entriesToFetch.length === 0) {
      enrichedBooks.push({ ...book });
      continue;
    }

    const nextBook = { ...book };

    for (const entry of entriesToFetch) {
      const audiobookUrl = entry.url;
      let title = null;
      let duration = null;
      let narrator = null;

      try {
        const page = await fetchAudiobookPage({ url: audiobookUrl, book: nextBook });
        const html = page?.html ?? '';
        if (isRutrackerUrl(entry.url) && !entry.title) {
          title = extractRutrackerAudiobookTitle(html);
        }
        if (!hasRecordedAudiobookEntryDuration(entry)) {
          duration = extractAudiobookDurationMinutes(html);
        }
        if (!entry.narrator) {
          narrator = extractAudiobookNarrator(html);
        }
      } catch (error) {
        if (typeof onFetchError === 'function') {
          onFetchError({ book: nextBook, url: audiobookUrl, error });
        }
      }

      const enrichedEntry = { url: audiobookUrl };
      if (title) {
        enrichedEntry.title = title;
      }
      if (duration !== null) {
        enrichedEntry.duration = duration;
      }
      if (narrator) {
        enrichedEntry.narrator = narrator;
      }
      if (title || duration !== null || narrator) {
        nextBook.audiobooks_urls = mergeAudiobookUrls(nextBook, [enrichedEntry]);
      }

      if (pageDelayMs > 0) {
        await sleep(pageDelayMs);
      }
    }

    enrichedBooks.push(withAverageAudiobookDuration(nextBook));
  }

  return enrichedBooks;
}
