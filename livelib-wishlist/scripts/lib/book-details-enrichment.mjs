import {
  extractAudiobookDurationMinutes,
  extractAudiobookNarrator,
  firstAudiobookEntryMissingNarratorForBook,
  firstAudiobookUrlForBook,
  hasAudiobookEntriesMissingNarrator,
  hasRecordedAudiobookDuration,
} from './audiobook-duration.mjs';
import { mergeAudiobookUrls } from './book-url-fields.mjs';
import {
  extractBookPageDetails,
  hasRecordedBookPageDescription,
  hasRecordedBookPageGenre,
  hasRecordedBookPageImage,
  needsBookPageDetails,
} from './livelib.mjs';

function createInitialBookDetailsStats() {
  return {
    skippedAudiobookDuration: 0,
    enrichedAudiobookDuration: 0,
    skippedAudiobookNarrator: 0,
    enrichedAudiobookNarrator: 0,
    skippedBookPageDetails: 0,
    enrichedBookDescriptions: 0,
    enrichedBookImages: 0,
    enrichedBookGenres: 0,
  };
}

function getMissingBookDetailsState(book) {
  return {
    hasDescription: hasRecordedBookPageDescription(book),
    hasImage: hasRecordedBookPageImage(book),
    hasGenre: hasRecordedBookPageGenre(book),
    needsBookPageDetails: needsBookPageDetails(book),
  };
}

function addBookDetailsStats(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getSleepFn(sleep, key) {
  if (typeof sleep === 'function') {
    return sleep;
  }

  if (typeof sleep?.[key] === 'function') {
    return sleep[key];
  }

  return defaultSleep;
}

export async function enrichBookWithMissingDetails(
  book,
  {
    fetchAudiobookPage,
    fetchBookPage,
    onAudiobookFetchError,
    onBookPageFetchError,
    pageDelayMs = 0,
    sleep = defaultSleep,
  } = {},
) {
  const nextBook = { ...book };
  const stats = createInitialBookDetailsStats();
  const audiobookUrl = firstAudiobookUrlForBook(nextBook);
  const missingNarratorEntry = firstAudiobookEntryMissingNarratorForBook(nextBook);
  const bookDetailsState = getMissingBookDetailsState(nextBook);

  if (hasRecordedAudiobookDuration(nextBook)) {
    stats.skippedAudiobookDuration += 1;
  }
  if (!missingNarratorEntry) {
    stats.skippedAudiobookNarrator += 1;
  }

  const shouldFetchAudiobookPage = (
    (!hasRecordedAudiobookDuration(nextBook) && audiobookUrl)
    || missingNarratorEntry
  ) && typeof fetchAudiobookPage === 'function';

  if (shouldFetchAudiobookPage) {
    const fetchUrl = hasRecordedAudiobookDuration(nextBook)
      ? missingNarratorEntry.url
      : audiobookUrl;
    try {
      const page = await fetchAudiobookPage({ url: fetchUrl, book: nextBook });
      const html = page?.html ?? '';
      const durationMinutes = extractAudiobookDurationMinutes(html);
      if (durationMinutes !== null && !hasRecordedAudiobookDuration(nextBook)) {
        nextBook.audiobook_duration_minutes = durationMinutes;
        stats.enrichedAudiobookDuration += 1;
      }

      if (missingNarratorEntry?.url === fetchUrl) {
        const narrator = extractAudiobookNarrator(html);
        if (narrator) {
          nextBook.audiobooks_urls = mergeAudiobookUrls(nextBook, [{
            url: missingNarratorEntry.url,
            narrator,
          }]);
          stats.enrichedAudiobookNarrator += 1;
        }
      }
    } catch (error) {
      if (typeof onAudiobookFetchError === 'function') {
        onAudiobookFetchError({ book: nextBook, url: fetchUrl, error });
      }
    }

    if (pageDelayMs > 0) {
      await getSleepFn(sleep, 'audiobook')(pageDelayMs);
    }
  }

  if (!bookDetailsState.needsBookPageDetails) {
    stats.skippedBookPageDetails += 1;
  } else if (nextBook.url && typeof fetchBookPage === 'function') {
    let details = { description: null, image: null, genre: null };
    try {
      const page = await fetchBookPage({ url: nextBook.url, book: nextBook });
      details = extractBookPageDetails(page?.html ?? '', page?.url ?? nextBook.url);
    } catch (error) {
      if (typeof onBookPageFetchError === 'function') {
        onBookPageFetchError({ book: nextBook, url: nextBook.url, error });
      }
    }

    if (!bookDetailsState.hasDescription && details.description) {
      nextBook.description = details.description;
      stats.enrichedBookDescriptions += 1;
    }
    if (!bookDetailsState.hasImage && details.image) {
      nextBook.image = details.image;
      stats.enrichedBookImages += 1;
    }
    if (!bookDetailsState.hasGenre) {
      nextBook.genre = details.genre;
      if (details.genre !== null) {
        stats.enrichedBookGenres += 1;
      }
    }

    if (pageDelayMs > 0) {
      await getSleepFn(sleep, 'bookPage')(pageDelayMs);
    }
  }

  return {
    book: nextBook,
    stats,
    needs: {
      audiobookDuration: !hasRecordedAudiobookDuration(nextBook) && Boolean(audiobookUrl),
      audiobookNarrator: hasAudiobookEntriesMissingNarrator(nextBook),
      bookPageDetails: needsBookPageDetails(nextBook),
    },
  };
}

export async function enrichBooksWithMissingDetails(books, options = {}) {
  if (!Array.isArray(books)) {
    throw new Error('Books must be an array');
  }

  const enrichedBooks = [];
  const stats = createInitialBookDetailsStats();

  for (const book of books) {
    const result = await enrichBookWithMissingDetails(book, options);
    enrichedBooks.push(result.book);
    addBookDetailsStats(stats, result.stats);
  }

  return {
    books: enrichedBooks,
    stats,
  };
}

export {
  extractAudiobookDurationMinutes,
  extractAudiobookNarrator,
  extractBookPageDetails,
  firstAudiobookEntryMissingNarratorForBook,
  firstAudiobookUrlForBook,
  hasAudiobookEntriesMissingNarrator,
  hasRecordedBookPageDescription,
  hasRecordedBookPageGenre,
  hasRecordedBookPageImage,
  hasRecordedAudiobookDuration,
  needsBookPageDetails,
};
