import {
  extractAudiobookDurationMinutes,
  firstAudiobookUrlForBook,
  hasRecordedAudiobookDuration,
} from './audiobook-duration.mjs';
import {
  extractBookPageDetails,
  hasRecordedBookPageDescription,
  hasRecordedBookPageImage,
  needsBookPageDetails,
} from './livelib.mjs';

function createInitialBookDetailsStats() {
  return {
    skippedAudiobookDuration: 0,
    enrichedAudiobookDuration: 0,
    skippedBookPageDetails: 0,
    enrichedBookDescriptions: 0,
    enrichedBookImages: 0,
  };
}

function getMissingBookDetailsState(book) {
  return {
    hasDescription: hasRecordedBookPageDescription(book),
    hasImage: hasRecordedBookPageImage(book),
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
  const bookDetailsState = getMissingBookDetailsState(nextBook);

  if (hasRecordedAudiobookDuration(nextBook)) {
    stats.skippedAudiobookDuration += 1;
  } else if (audiobookUrl && typeof fetchAudiobookPage === 'function') {
    try {
      const page = await fetchAudiobookPage({ url: audiobookUrl, book: nextBook });
      const durationMinutes = extractAudiobookDurationMinutes(page?.html ?? '');
      if (durationMinutes !== null) {
        nextBook.audiobook_duration_minutes = durationMinutes;
        stats.enrichedAudiobookDuration += 1;
      }
    } catch (error) {
      if (typeof onAudiobookFetchError === 'function') {
        onAudiobookFetchError({ book: nextBook, url: audiobookUrl, error });
      }
    }

    if (pageDelayMs > 0) {
      await getSleepFn(sleep, 'audiobook')(pageDelayMs);
    }
  }

  if (!bookDetailsState.needsBookPageDetails) {
    stats.skippedBookPageDetails += 1;
  } else if (nextBook.url && typeof fetchBookPage === 'function') {
    let details = { description: null, image: null };
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

    if (pageDelayMs > 0) {
      await getSleepFn(sleep, 'bookPage')(pageDelayMs);
    }
  }

  return {
    book: nextBook,
    stats,
    needs: {
      audiobookDuration: !hasRecordedAudiobookDuration(nextBook) && Boolean(audiobookUrl),
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
  extractBookPageDetails,
  firstAudiobookUrlForBook,
  hasRecordedBookPageDescription,
  hasRecordedBookPageImage,
  hasRecordedAudiobookDuration,
  needsBookPageDetails,
};
