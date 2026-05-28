import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enrichBooksWithBookPageDetails,
  extractBookPageDetails,
  extractBooks,
  extractBooksFromPages,
  extractBookUrls,
  extractBookUrlsFromPages,
  extractWishlistPageUrls,
  matchBooksByLiveLibUrl,
  mergeExistingLiveLibBooks,
  needsBookPageDetails,
  normalizeBookUrl,
  normalizeWishlistPageUrl,
  parseLivelibWishlistUrl,
} from '../scripts/lib/livelib.mjs';

test('accepts LiveLib wishlist URL', () => {
  const result = parseLivelibWishlistUrl('https://www.livelib.ru/reader/LiraLantan/wish');

  assert.equal(result.username, 'LiraLantan');
  assert.equal(result.url, 'https://www.livelib.ru/reader/LiraLantan/wish');
});

test('normalizes trailing slash', () => {
  const result = parseLivelibWishlistUrl('http://www.livelib.ru/reader/LiraLantan/wish/');

  assert.equal(result.url, 'https://www.livelib.ru/reader/LiraLantan/wish');
});

test('rejects non-wishlist URLs', () => {
  const urls = [
    'https://www.livelib.ru/reader/LiraLantan/wish/print',
    'https://www.livelib.ru/reader/LiraLantan/read/print',
    'https://livelib.ru/reader/LiraLantan/wish',
    'ftp://www.livelib.ru/reader/LiraLantan/wish',
  ];

  for (const url of urls) {
    assert.throws(() => parseLivelibWishlistUrl(url));
  }
});

test('normalizes only same wishlist page URLs', () => {
  assert.equal(
    normalizeWishlistPageUrl(
      '/reader/LiraLantan/wish?page=2',
      'LiraLantan',
      'https://www.livelib.ru/reader/LiraLantan/wish',
    ),
    'https://www.livelib.ru/reader/LiraLantan/wish?page=2',
  );

  assert.equal(
    normalizeWishlistPageUrl(
      '/reader/LiraLantan/read?page=2',
      'LiraLantan',
      'https://www.livelib.ru/reader/LiraLantan/wish',
    ),
    null,
  );

  assert.equal(
    normalizeWishlistPageUrl(
      '/reader/LiraLantan/wish/listview/smalllist/~2',
      'LiraLantan',
      'https://www.livelib.ru/reader/LiraLantan/wish',
    ),
    'https://www.livelib.ru/reader/LiraLantan/wish/listview/smalllist/~2',
  );
});

test('rejects non-pagination wishlist URLs', () => {
  const baseUrl = 'https://www.livelib.ru/reader/LiraLantan/wish';
  const urls = [
    '/reader/LiraLantan/wish',
    '/reader/LiraLantan/wish?page=1',
    '/reader/LiraLantan/wish?page=2&utm_source=footer',
    '/reader/LiraLantan/wish?page=2&version=mobile',
    '/reader/LiraLantan/wish?page=two',
    '/reader/LiraLantan/wish?page=2.5',
    '/reader/LiraLantan/wish/listview/smalllist/~1',
    '/reader/LiraLantan/wish/listview/smalllist/~2?utm_source=footer',
    '/reader/LiraLantan/wish/listview/smalllist/~two',
  ];

  for (const url of urls) {
    assert.equal(normalizeWishlistPageUrl(url, 'LiraLantan', baseUrl), null);
  }
});

test('extracts real wishlist pagination links without duplicates', () => {
  const html = `
    <a href="/reader/LiraLantan/wish?page=2">2</a>
    <a href="https://www.livelib.ru/reader/LiraLantan/wish?page=3">3</a>
    <a href="/reader/LiraLantan/wish/listview/smalllist/~4">4</a>
    <a href="/reader/LiraLantan/wish/listview/biglist/~5">5</a>
    <a href="/reader/LiraLantan/wish">wishlist footer</a>
    <a href="/reader/LiraLantan/wish?page=1">1</a>
    <a href="/reader/LiraLantan/wish?page=4&utm_source=footer">footer tracking</a>
    <a href="/reader/LiraLantan/wish?page=5&version=mobile">mobile</a>
    <a href="/reader/LiraLantan/read?page=2">read</a>
    <a href="/reader/OtherUser/wish?page=2">other</a>
    <a href="/book/100000">book</a>
    <a href="/reader/LiraLantan/wish?page=2">duplicate</a>
  `;

  const urls = extractWishlistPageUrls(
    html,
    'LiraLantan',
    'https://www.livelib.ru/reader/LiraLantan/wish',
  );

  assert.deepEqual(urls, [
    'https://www.livelib.ru/reader/LiraLantan/wish?page=2',
    'https://www.livelib.ru/reader/LiraLantan/wish?page=3',
    'https://www.livelib.ru/reader/LiraLantan/wish/listview/smalllist/~4',
    'https://www.livelib.ru/reader/LiraLantan/wish/listview/biglist/~5',
  ]);
});

test('normalizes only LiveLib book and work URLs', () => {
  const baseUrl = 'https://www.livelib.ru/reader/LiraLantan/wish';

  assert.equal(
    normalizeBookUrl('/book/100000', baseUrl),
    'https://www.livelib.ru/book/100000',
  );
  assert.equal(
    normalizeBookUrl('https://www.livelib.ru/book/100000?utm_source=list#reviews', baseUrl),
    'https://www.livelib.ru/book/100000',
  );
  assert.equal(
    normalizeBookUrl('/work/1002365277-v-nochnom-sadu-ketrin-m-valente', baseUrl),
    'https://www.livelib.ru/work/1002365277-v-nochnom-sadu-ketrin-m-valente',
  );

  const rejectedUrls = [
    '/reader/LiraLantan/wish',
    '/bookseries/100000',
    '/book/100000/readers',
    '/book/100000/reviews-title',
    '/work/100000/readers',
    'https://example.com/book/100000',
    'mailto:test@example.com',
  ];

  for (const url of rejectedUrls) {
    assert.equal(normalizeBookUrl(url, baseUrl), null);
  }
});

test('extracts unique book URLs from one page', () => {
  const html = `
    <a href="/book/100000">Book One</a>
    <a href="https://www.livelib.ru/book/200000">Book Two</a>
    <a href="/work/300000">Work Three</a>
    <a href="/book/100000?utm_source=duplicate">Book One duplicate</a>
    <a href="/book/100000/readers">readers</a>
    <a href="/reader/LiraLantan/wish?page=2">pagination</a>
    <a href="https://example.com/book/300000">external</a>
  `;

  assert.deepEqual(
    extractBookUrls(html, 'https://www.livelib.ru/reader/LiraLantan/wish'),
    [
      'https://www.livelib.ru/book/100000',
      'https://www.livelib.ru/book/200000',
      'https://www.livelib.ru/work/300000',
    ],
  );
});

test('extracts unique book URLs across fetched pages', () => {
  const pages = [
    {
      url: 'https://www.livelib.ru/reader/LiraLantan/wish',
      html: '<a href="/book/100000">Book One</a><a href="/book/200000">Book Two</a>',
    },
    {
      url: 'https://www.livelib.ru/reader/LiraLantan/wish/listview/smalllist/~2',
      html: '<a href="/book/200000">Book Two again</a><a href="/book/300000">Book Three</a>',
    },
  ];

  assert.deepEqual(extractBookUrlsFromPages(pages), [
    'https://www.livelib.ru/book/100000',
    'https://www.livelib.ru/book/200000',
    'https://www.livelib.ru/book/300000',
  ]);
});

test('extracts book title, authors, and URL from a wishlist card', () => {
  const html = `
    <div class="brow-book">
      <a href="/book/100000-cover" title="Cover"></a>
      <div>
        <a class="brow-book-name with-cycle" href="/book/100000-title?utm_source=list">
          The   First   Book
        </a>
        <a class="brow-book-author" href="/author/1">Author One</a>
        <a class="brow-book-author" href="/author/2">Author Two, Author Three</a>
        <a class="brow-book-author" href="/author/2">Author Two</a>
        <a href="/book/100000-title/reviews">10 reviews</a>
      </div>
    </div>
  `;

  assert.deepEqual(extractBooks(html, 'https://www.livelib.ru/reader/LiraLantan/wish'), [
    {
      title: 'The First Book',
      authors: ['Author One', 'Author Two', 'Author Three'],
      url: 'https://www.livelib.ru/book/100000-title',
    },
  ]);
});

test('extracts work URLs used by LiveLib wishlist cards', () => {
  const html = `
    <div class="brow-book">
      <a class="brow-book-name" href="/work/1002365277-v-nochnom-sadu-ketrin-m-valente">
        В ночном саду
      </a>
      <a class="brow-book-author" href="/author/1">Кэтрин М. Валенте</a>
    </div>
  `;

  assert.deepEqual(extractBooks(html, 'https://www.livelib.ru/reader/LiraLantan/wish'), [
    {
      title: 'В ночном саду',
      authors: ['Кэтрин М. Валенте'],
      url: 'https://www.livelib.ru/work/1002365277-v-nochnom-sadu-ketrin-m-valente',
    },
  ]);
});

test('extracts unique books across fetched pages', () => {
  const pages = [
    {
      url: 'https://www.livelib.ru/reader/LiraLantan/wish',
      html: `
        <div class="brow-book">
          <a class="brow-book-name" href="/book/100000">Book One</a>
          <a class="brow-book-author" href="/author/1">Author One</a>
        </div>
      `,
    },
    {
      url: 'https://www.livelib.ru/reader/LiraLantan/wish/listview/smalllist/~2',
      html: `
        <div class="brow-book">
          <a class="brow-book-name" href="/book/100000">Book One duplicate</a>
          <a class="brow-book-author" href="/author/1">Author One</a>
        </div>
        <div class="brow-book">
          <a class="brow-book-name" href="/book/200000">Book Two</a>
          <a class="brow-book-author" href="/author/2">Author Two</a>
        </div>
      `,
    },
  ];

  assert.deepEqual(extractBooksFromPages(pages), [
    {
      title: 'Book One',
      authors: ['Author One'],
      url: 'https://www.livelib.ru/book/100000',
    },
    {
      title: 'Book Two',
      authors: ['Author Two'],
      url: 'https://www.livelib.ru/book/200000',
    },
  ]);
});

test('extracts LiveLib book page description and image from explicit metadata', () => {
  const html = `
    <meta property="og:description" content="  Atmospheric   book description.  ">
    <meta property="og:image" content="/images/book-cover.jpg">
  `;

  assert.deepEqual(
    extractBookPageDetails(html, 'https://www.livelib.ru/book/100000-title'),
    {
      description: 'Atmospheric book description.',
      image: 'https://www.livelib.ru/images/book-cover.jpg',
      genre: null,
    },
  );
});

test('extracts LiveLib book page description from about text and image from page content', () => {
  const html = `
    <section class="bc-about__txt">
      Описание книги
      A  careful   visible description.
      Читать полностью
    </section>
    <img class="book-cover" data-src="//i.livelib.ru/boocover/100000.jpg">
  `;

  assert.deepEqual(
    extractBookPageDetails(html, 'https://www.livelib.ru/book/100000-title'),
    {
      description: 'A careful visible description.',
      image: 'https://i.livelib.ru/boocover/100000.jpg',
      genre: null,
    },
  );
});

test('extracts normalized LiveLib book page genre from book info', () => {
  const cases = [
    ['<div class="bc-info__item">Жанр: Научно-популярная литература</div>', 'научпоп'],
    ['<div class="bc-info__item">Космическая фантастика</div>', 'фантастика'],
    ['<div class="bc-info__item">Героическое фэнтези</div>', 'фэнтези'],
    ['<div class="bc-info__item">Современная проза</div>', null],
  ];

  for (const [html, genre] of cases) {
    assert.equal(
      extractBookPageDetails(html, 'https://www.livelib.ru/book/100000-title').genre,
      genre,
    );
  }
});

test('returns null LiveLib book page details when description, image, and genre are missing', () => {
  const html = '<main><h1>Book title</h1><img src="data:image/gif;base64,abc"></main>';

  assert.deepEqual(
    extractBookPageDetails(html, 'https://www.livelib.ru/book/100000-title'),
    {
      description: null,
      image: null,
      genre: null,
    },
  );
});

test('detects books that need LiveLib book page details', () => {
  assert.equal(
    needsBookPageDetails({
      description: 'Done',
      image: 'https://example.com/cover.jpg',
      genre: null,
    }),
    false,
  );
  assert.equal(needsBookPageDetails({ description: 'Done', image: 'https://example.com/cover.jpg' }), true);
  assert.equal(needsBookPageDetails({ description: 'Done' }), true);
  assert.equal(needsBookPageDetails({ image: 'https://example.com/cover.jpg' }), true);
  assert.equal(needsBookPageDetails({ description: ' ', image: 'https://example.com/cover.jpg' }), true);
});

test('enriches only books with missing LiveLib book page details', async () => {
  const calls = [];
  const books = [
    {
      title: 'Already enriched',
      url: 'https://www.livelib.ru/book/100000',
      description: 'Existing description',
      image: 'https://i.livelib.ru/boocover/existing.jpg',
      genre: null,
      yandex_books_urls: ['https://books.yandex.ru/books/existing'],
    },
    {
      title: 'Recorded null genre',
      url: 'https://www.livelib.ru/book/150000',
      description: 'Existing description',
      image: 'https://i.livelib.ru/boocover/null-genre.jpg',
      genre: null,
    },
    {
      title: 'Needs both',
      url: 'https://www.livelib.ru/book/200000',
      yandex_books_urls: [],
    },
    {
      title: 'Needs image only',
      url: 'https://www.livelib.ru/work/300000',
      description: 'Keep this description',
      audiobook_duration_minutes: 515,
    },
    {
      title: 'Missing details on page',
      url: 'https://www.livelib.ru/book/400000',
    },
  ];

  const enriched = await enrichBooksWithBookPageDetails(books, {
    fetchBookPage: async ({ url }) => {
      calls.push(url);
      if (url.includes('/book/400000')) {
        return {
          url,
          html: '<html><body>No useful details</body></html>',
        };
      }

      return {
        url,
        html: `
          <meta property="og:description" content="Fetched description for ${url}">
          <meta property="og:image" content="/covers/${url.split('/').at(-1)}.jpg">
          <div class="bc-info__item">Жанр: фантастика</div>
        `,
      };
    },
  });

  assert.deepEqual(calls, [
    'https://www.livelib.ru/book/200000',
    'https://www.livelib.ru/work/300000',
    'https://www.livelib.ru/book/400000',
  ]);
  assert.deepEqual(enriched[0], books[0]);
  assert.deepEqual(enriched[1], books[1]);
  assert.equal(enriched[2].description, 'Fetched description for https://www.livelib.ru/book/200000');
  assert.equal(enriched[2].image, 'https://www.livelib.ru/covers/200000.jpg');
  assert.equal(enriched[2].genre, 'фантастика');
  assert.equal(enriched[3].description, 'Keep this description');
  assert.equal(enriched[3].image, 'https://www.livelib.ru/covers/300000.jpg');
  assert.equal(enriched[3].genre, 'фантастика');
  assert.equal(enriched[3].audiobook_duration_minutes, 515);
  assert.equal('description' in enriched[4], false);
  assert.equal('image' in enriched[4], false);
  assert.equal('genre' in enriched[4], false);
});

test('updates only missing LiveLib book page detail fields while preserving saved data', async () => {
  const books = [
    {
      title: 'Saved title',
      authors: ['Saved Author'],
      url: 'https://www.livelib.ru/book/100000',
      description: 'Saved description',
      genre: 'научпоп',
      yandex_books_urls: ['https://books.yandex.ru/books/saved'],
      litres_urls: ['https://www.litres.ru/book/author/saved-123'],
      audiobook_duration_minutes: 515,
      livelib_note: 'keep me',
    },
  ];

  const enriched = await enrichBooksWithBookPageDetails(books, {
    fetchBookPage: async ({ url }) => ({
      url,
      html: `
        <meta property="og:description" content="Fetched description must not replace saved one">
        <meta property="og:image" content="/covers/100000.jpg">
        <div class="bc-info__item">Жанр: фэнтези</div>
      `,
    }),
  });

  assert.deepEqual(enriched, [
    {
      title: 'Saved title',
      authors: ['Saved Author'],
      url: 'https://www.livelib.ru/book/100000',
      description: 'Saved description',
      image: 'https://www.livelib.ru/covers/100000.jpg',
      genre: 'научпоп',
      yandex_books_urls: ['https://books.yandex.ru/books/saved'],
      litres_urls: ['https://www.litres.ru/book/author/saved-123'],
      audiobook_duration_minutes: 515,
      livelib_note: 'keep me',
    },
  ]);
});

test('keeps enriching LiveLib book page details after a failed page fetch', async () => {
  const errors = [];
  const books = [
    {
      title: 'Broken',
      url: 'https://www.livelib.ru/book/broken',
    },
    {
      title: 'Working',
      url: 'https://www.livelib.ru/book/working',
    },
  ];

  const enriched = await enrichBooksWithBookPageDetails(books, {
    fetchBookPage: async ({ url }) => {
      if (url.includes('broken')) {
        throw new Error('LiveLib timeout');
      }

      return {
        url,
        html: `
          <meta property="og:description" content="Recovered">
          <meta property="og:image" content="/cover.jpg">
          <div class="bc-info__item">Жанр: фэнтези</div>
        `,
      };
    },
    onFetchError({ book, error }) {
      errors.push(`${book.title}: ${error.message}`);
    },
  });

  assert.deepEqual(errors, ['Broken: LiveLib timeout']);
  assert.deepEqual(enriched[0], books[0]);
  assert.equal(enriched[1].description, 'Recovered');
  assert.equal(enriched[1].image, 'https://www.livelib.ru/cover.jpg');
  assert.equal(enriched[1].genre, 'фэнтези');
});

test('matches LiveLib books with existing books by LiveLib URL', () => {
  const livelibBooks = [
    {
      title: 'Book One from LiveLib',
      authors: ['Author One'],
      url: 'https://www.livelib.ru/book/100000',
    },
    {
      title: 'Book Two from LiveLib',
      authors: ['Author Two'],
      url: 'https://www.livelib.ru/book/200000',
    },
  ];
  const existingBooks = [
    {
      title: 'Book One from file',
      authors: ['Old Author One'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: ['https://books.yandex.ru/books/existing'],
    },
    {
      title: 'Removed Book',
      authors: ['Removed Author'],
      url: 'https://www.livelib.ru/book/300000',
      yandex_books_urls: ['https://books.yandex.ru/books/removed'],
    },
  ];

  assert.deepEqual(matchBooksByLiveLibUrl(livelibBooks, existingBooks), {
    matched: [
      {
        livelibBook: livelibBooks[0],
        existingBook: existingBooks[0],
      },
      {
        livelibBook: livelibBooks[1],
        existingBook: null,
      },
    ],
    newBooks: [livelibBooks[1]],
    removedBooks: [existingBooks[1]],
  });
});

test('keeps existing file data for books still present on LiveLib', () => {
  const livelibBooks = [
    {
      title: 'Book One from LiveLib',
      authors: ['Author One'],
      url: 'https://www.livelib.ru/book/100000',
    },
    {
      title: 'Book Two from LiveLib',
      authors: ['Author Two'],
      url: 'https://www.livelib.ru/book/200000',
    },
  ];
  const existingBooks = [
    {
      title: 'Book One from file',
      authors: ['Old Author One'],
      url: 'https://www.livelib.ru/book/100000',
      livelib_note: 'keep me',
      yandex_books_urls: ['https://books.yandex.ru/books/existing'],
      rutracker_urls: ['https://rutracker.org/forum/viewtopic.php?t=100000'],
    },
  ];

  assert.deepEqual(mergeExistingLiveLibBooks(livelibBooks, existingBooks), [
    existingBooks[0],
    {
      ...livelibBooks[1],
      yandex_books_urls: [],
      rutracker_urls: [],
    },
  ]);
});

test('adds empty search URL arrays for new LiveLib books', () => {
  const livelibBooks = [
    {
      title: 'New Book',
      authors: ['New Author'],
      url: 'https://www.livelib.ru/book/100000',
    },
  ];

  assert.deepEqual(mergeExistingLiveLibBooks(livelibBooks, []), [
    {
      title: 'New Book',
      authors: ['New Author'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: [],
      rutracker_urls: [],
    },
  ]);
});

test('removes books missing from the current LiveLib wishlist during merge', () => {
  const livelibBooks = [
    {
      title: 'Current Book',
      authors: ['Current Author'],
      url: 'https://www.livelib.ru/book/100000',
    },
  ];
  const existingBooks = [
    {
      title: 'Current Book from file',
      authors: ['Old Current Author'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: ['https://books.yandex.ru/books/current'],
    },
    {
      title: 'Removed Book',
      authors: ['Removed Author'],
      url: 'https://www.livelib.ru/book/200000',
      yandex_books_urls: ['https://books.yandex.ru/books/removed'],
    },
  ];

  assert.deepEqual(mergeExistingLiveLibBooks(livelibBooks, existingBooks), [
    existingBooks[0],
  ]);
});

test('keeps current LiveLib order while merging existing books', () => {
  const livelibBooks = [
    {
      title: 'Book Two from LiveLib',
      authors: ['Author Two'],
      url: 'https://www.livelib.ru/book/200000',
    },
    {
      title: 'Book One from LiveLib',
      authors: ['Author One'],
      url: 'https://www.livelib.ru/book/100000',
    },
    {
      title: 'Book Three from LiveLib',
      authors: ['Author Three'],
      url: 'https://www.livelib.ru/book/300000',
    },
  ];
  const existingBooks = [
    {
      title: 'Book One from file',
      authors: ['Old Author One'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: ['https://books.yandex.ru/books/one'],
      rutracker_urls: ['https://rutracker.org/forum/viewtopic.php?t=100000'],
    },
    {
      title: 'Book Two from file',
      authors: ['Old Author Two'],
      url: 'https://www.livelib.ru/book/200000',
      yandex_books_urls: ['https://books.yandex.ru/books/two'],
      rutracker_urls: ['https://rutracker.org/forum/viewtopic.php?t=200000'],
    },
  ];

  assert.deepEqual(mergeExistingLiveLibBooks(livelibBooks, existingBooks), [
    existingBooks[1],
    existingBooks[0],
    {
      ...livelibBooks[2],
      yandex_books_urls: [],
      rutracker_urls: [],
    },
  ]);
});
