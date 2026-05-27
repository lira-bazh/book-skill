import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enrichBooksWithMissingDetails,
} from '../scripts/lib/book-details-enrichment.mjs';

test('enriches only audiobook duration when LiveLib details are already recorded', async () => {
  const audiobookCalls = [];
  const bookPageCalls = [];
  const books = [
    {
      title: 'Needs audio only',
      url: 'https://www.livelib.ru/book/100000',
      description: 'Existing description',
      image: 'https://www.livelib.ru/image.jpg',
      genre: null,
      yandex_books_urls: ['https://books.yandex.ru/audiobooks/needed'],
    },
  ];

  const result = await enrichBooksWithMissingDetails(books, {
    fetchAudiobookPage: async ({ url }) => {
      audiobookCalls.push(url);
      return { url, html: '<html><body>8 ч 35 мин</body></html>' };
    },
    fetchBookPage: async ({ url }) => {
      bookPageCalls.push(url);
      return { url, html: '' };
    },
  });

  assert.deepEqual(audiobookCalls, ['https://books.yandex.ru/audiobooks/needed']);
  assert.deepEqual(bookPageCalls, []);
  assert.equal(result.books[0].audiobook_duration_minutes, 515);
  assert.equal(result.books[0].description, 'Existing description');
  assert.equal(result.books[0].image, 'https://www.livelib.ru/image.jpg');
  assert.equal(result.books[0].genre, null);
  assert.deepEqual(result.stats, {
    skippedAudiobookDuration: 0,
    enrichedAudiobookDuration: 1,
    skippedBookPageDetails: 1,
    enrichedBookDescriptions: 0,
    enrichedBookImages: 0,
    enrichedBookGenres: 0,
  });
});

test('enriches only missing LiveLib description and image', async () => {
  const audiobookCalls = [];
  const bookPageCalls = [];
  const books = [
    {
      title: 'Needs details only',
      url: 'https://www.livelib.ru/book/200000',
      yandex_books_urls: ['https://books.yandex.ru/books/plain'],
    },
  ];

  const result = await enrichBooksWithMissingDetails(books, {
    fetchAudiobookPage: async ({ url }) => {
      audiobookCalls.push(url);
      return { url, html: '' };
    },
    fetchBookPage: async ({ url }) => {
      bookPageCalls.push(url);
      return {
        url,
        html: `
          <html>
            <head>
              <meta property="og:description" content="Book description">
              <meta property="og:image" content="/cover.jpg">
            </head>
            <body>
              <div class="bc-info__item">Жанр: фэнтези</div>
            </body>
          </html>
        `,
      };
    },
  });

  assert.deepEqual(audiobookCalls, []);
  assert.deepEqual(bookPageCalls, ['https://www.livelib.ru/book/200000']);
  assert.equal(result.books[0].description, 'Book description');
  assert.equal(result.books[0].image, 'https://www.livelib.ru/cover.jpg');
  assert.equal(result.books[0].genre, 'фэнтези');
  assert.deepEqual(result.stats, {
    skippedAudiobookDuration: 0,
    enrichedAudiobookDuration: 0,
    skippedBookPageDetails: 0,
    enrichedBookDescriptions: 1,
    enrichedBookImages: 1,
    enrichedBookGenres: 1,
  });
});

test('does not write missing LiveLib genre when page has no mapped genre', async () => {
  const result = await enrichBooksWithMissingDetails([
    {
      title: 'No mapped genre',
      url: 'https://www.livelib.ru/book/250000',
      description: 'Existing description',
      image: 'https://www.livelib.ru/cover.jpg',
    },
  ], {
    fetchBookPage: async ({ url }) => ({
      url,
      html: '<div class="bc-info__item">Современная проза</div>',
    }),
  });

  assert.equal('genre' in result.books[0], false);
  assert.deepEqual(result.stats, {
    skippedAudiobookDuration: 0,
    enrichedAudiobookDuration: 0,
    skippedBookPageDetails: 0,
    enrichedBookDescriptions: 0,
    enrichedBookImages: 0,
    enrichedBookGenres: 0,
  });
});

test('does not overwrite existing LiveLib genre', async () => {
  const books = [
    {
      title: 'Existing genre',
      url: 'https://www.livelib.ru/book/260000',
      description: 'Existing description',
      image: 'https://www.livelib.ru/cover.jpg',
      genre: 'научпоп',
    },
    {
      title: 'Existing null genre',
      url: 'https://www.livelib.ru/book/270000',
      description: 'Existing description',
      image: 'https://www.livelib.ru/null-genre.jpg',
      genre: null,
    },
  ];

  const result = await enrichBooksWithMissingDetails(books, {
    fetchBookPage: async () => {
      throw new Error('book page fetch should not be called');
    },
  });

  assert.deepEqual(result.books, books);
  assert.deepEqual(result.stats, {
    skippedAudiobookDuration: 0,
    enrichedAudiobookDuration: 0,
    skippedBookPageDetails: 2,
    enrichedBookDescriptions: 0,
    enrichedBookImages: 0,
    enrichedBookGenres: 0,
  });
});

test('enriches audiobook duration and LiveLib details in one pass', async () => {
  const calls = [];
  const books = [
    {
      title: 'Needs everything',
      url: 'https://www.livelib.ru/book/300000',
      litres_urls: ['https://www.litres.ru/audiobook/author/title-123'],
    },
  ];

  const result = await enrichBooksWithMissingDetails(books, {
    fetchAudiobookPage: async ({ url }) => {
      calls.push(['audio', url]);
      return { url, html: '<html><body>1 ч 20 мин</body></html>' };
    },
    fetchBookPage: async ({ url }) => {
      calls.push(['book', url]);
      return {
        url,
        html: `
          <html>
            <head>
              <meta name="description" content="Combined description">
              <meta itemprop="image" content="https://cdn.example.test/cover.png">
            </head>
            <body>
              <div class="bc-info__item">Научно-популярная литература</div>
            </body>
          </html>
        `,
      };
    },
  });

  assert.deepEqual(calls, [
    ['audio', 'https://www.litres.ru/audiobook/author/title-123'],
    ['book', 'https://www.livelib.ru/book/300000'],
  ]);
  assert.equal(result.books[0].audiobook_duration_minutes, 80);
  assert.equal(result.books[0].description, 'Combined description');
  assert.equal(result.books[0].image, 'https://cdn.example.test/cover.png');
  assert.equal(result.books[0].genre, 'научпоп');
  assert.deepEqual(result.stats, {
    skippedAudiobookDuration: 0,
    enrichedAudiobookDuration: 1,
    skippedBookPageDetails: 0,
    enrichedBookDescriptions: 1,
    enrichedBookImages: 1,
    enrichedBookGenres: 1,
  });
});

test('skips network requests when all details are already recorded', async () => {
  const books = [
    {
      title: 'Complete book',
      url: 'https://www.livelib.ru/book/400000',
      audiobook_duration_minutes: 42,
      description: 'Recorded description',
      image: 'https://www.livelib.ru/recorded.jpg',
      genre: null,
      yandex_books_urls: ['https://books.yandex.ru/audiobooks/complete'],
    },
  ];

  const result = await enrichBooksWithMissingDetails(books, {
    fetchAudiobookPage: async () => {
      throw new Error('audiobook fetch should not be called');
    },
    fetchBookPage: async () => {
      throw new Error('book page fetch should not be called');
    },
  });

  assert.deepEqual(result.books, books);
  assert.deepEqual(result.stats, {
    skippedAudiobookDuration: 1,
    enrichedAudiobookDuration: 0,
    skippedBookPageDetails: 1,
    enrichedBookDescriptions: 0,
    enrichedBookImages: 0,
    enrichedBookGenres: 0,
  });
});

test('continues processing when one fetcher fails', async () => {
  const warnings = [];
  const books = [
    {
      title: 'Broken audio',
      url: 'https://www.livelib.ru/book/500000',
      description: 'Already described',
      image: 'https://www.livelib.ru/already.jpg',
      genre: null,
      yandex_books_urls: ['https://books.yandex.ru/audiobooks/broken'],
    },
    {
      title: 'Next book',
      url: 'https://www.livelib.ru/book/600000',
    },
  ];

  const result = await enrichBooksWithMissingDetails(books, {
    fetchAudiobookPage: async () => {
      throw new Error('network failed');
    },
    fetchBookPage: async ({ url }) => ({
      url,
      html: `
        <html>
          <head>
            <meta property="og:description" content="Recovered description">
            <meta property="og:image" content="/recovered.jpg">
          </head>
          <body>
            <div class="bc-info__item">Жанр: фантастика</div>
          </body>
        </html>
      `,
    }),
    onAudiobookFetchError: ({ book, error }) => {
      warnings.push([book.title, error.message]);
    },
  });

  assert.deepEqual(warnings, [['Broken audio', 'network failed']]);
  assert.equal('audiobook_duration_minutes' in result.books[0], false);
  assert.equal(result.books[1].description, 'Recovered description');
  assert.equal(result.books[1].image, 'https://www.livelib.ru/recovered.jpg');
  assert.equal(result.books[1].genre, 'фантастика');
  assert.deepEqual(result.stats, {
    skippedAudiobookDuration: 0,
    enrichedAudiobookDuration: 0,
    skippedBookPageDetails: 1,
    enrichedBookDescriptions: 1,
    enrichedBookImages: 1,
    enrichedBookGenres: 1,
  });
});
