import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildYandexBooksSearchUrl,
  countBooksWithExistingYandexBooksUrls,
  enrichBooksWithYandexBooksUrls,
  extractMatchingYandexBooksUrls,
  extractYandexBooksSearchResults,
  extractYandexBooksUrls,
  filterYandexBooksResultsForBook,
  isSimilarYandexBooksAuthor,
  isYandexBooksResultSimilarToBook,
  normalizeYandexBooksUrl,
} from '../scripts/lib/yandex-books.mjs';

test('builds Yandex Books search URL', () => {
  const searchUrl = new URL(buildYandexBooksSearchUrl(' Сто лет одиночества  Маркес '));

  assert.equal(searchUrl.origin, 'https://books.yandex.ru');
  assert.equal(
    decodeURIComponent(searchUrl.pathname),
    '/search/all/Сто лет одиночества Маркес',
  );
  assert.equal(searchUrl.search, '');
});

test('rejects empty Yandex Books search query', () => {
  assert.throws(() => buildYandexBooksSearchUrl('   '));
});

test('normalizes only Yandex Books content URLs', () => {
  const baseUrl = 'https://books.yandex.ru/search/all/test';

  assert.equal(
    normalizeYandexBooksUrl('/books/RuLNt8od', baseUrl),
    'https://books.yandex.ru/books/RuLNt8od',
  );
  assert.equal(
    normalizeYandexBooksUrl('/audiobooks/DdVH9BNW?utm_source=test#fragment', baseUrl),
    'https://books.yandex.ru/audiobooks/DdVH9BNW',
  );
  assert.equal(
    normalizeYandexBooksUrl('https://books.yandex.ru/books/Eyxip4ae', baseUrl),
    'https://books.yandex.ru/books/Eyxip4ae',
  );

  const rejectedUrls = [
    '/books',
    '/bookshelves/',
    '/bookshelves/top',
    '/audiobooks',
    '/series/123',
    '/serial/123',
    '/authors/123',
    '/narrators/123',
    '/users/123',
    '/search/all/test',
    '/books/RuLNt8od/chapters',
    'https://example.com/books/RuLNt8od',
    'mailto:test@example.com',
  ];

  for (const url of rejectedUrls) {
    assert.equal(normalizeYandexBooksUrl(url, baseUrl), null);
  }
});

test('extracts unique Yandex Books content URLs from search HTML', () => {
  const html = `
    <a href="/books">Главное</a>
    <a href="/books/RuLNt8od">Сто лет одиночества</a>
    <a href="/books/RuLNt8od?utm_source=duplicate">Сто лет одиночества duplicate</a>
    <a href="https://books.yandex.ru/books/Eyxip4ae">Полковнику никто не пишет</a>
    <a href="/audiobooks/DdVH9BNW">Увидимся в августе</a>
    <a href="/search/all/test">search</a>
    <a href="https://example.com/books/External">external</a>
  `;

  assert.deepEqual(
    extractYandexBooksUrls(html, 'https://books.yandex.ru/search/all/test'),
    [
      'https://books.yandex.ru/books/RuLNt8od',
      'https://books.yandex.ru/books/Eyxip4ae',
      'https://books.yandex.ru/audiobooks/DdVH9BNW',
    ],
  );
});

test('extracts Yandex Books search results with title, authors, and URL', () => {
  const html = `
    <div data-test-id="SNIPPET">
      <a href="/books/RuLNt8od">
        <span>Сто лет одиночества</span>
      </a>
      <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">
        Габриэль Гарсиа Маркес
      </a>
      <a href="/authors/other">wrong first non-content link</a>
    </div>
    <div data-test-id="SNIPPET">
      <a href="/books/RuLNt8od?utm_source=duplicate">Duplicate</a>
      <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
    </div>
    <div data-test-id="SNIPPET">
      <a href="/bookshelves/top">Подборка</a>
      <a data-test-id="SNIPPET_AUTHORS" href="/authors/x">Автор подборки</a>
    </div>
    <div data-test-id="SNIPPET">
      <a href="/audiobooks/DdVH9BNW">Увидимся в августе</a>
      <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
      <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
    </div>
  `;

  assert.deepEqual(
    extractYandexBooksSearchResults(html, 'https://books.yandex.ru/search/all/test'),
    [
      {
        title: 'Сто лет одиночества',
        authors: ['Габриэль Гарсиа Маркес'],
        url: 'https://books.yandex.ru/books/RuLNt8od',
      },
      {
        title: 'Увидимся в августе',
        authors: ['Габриэль Гарсиа Маркес'],
        url: 'https://books.yandex.ru/audiobooks/DdVH9BNW',
      },
    ],
  );
});

test('extracts Yandex Books authors without et al marker', () => {
  const html = `
    <div data-test-id="SNIPPET">
      <a href="/books/SunPendulum">Под маятником солнца</a>
      <a data-test-id="SNIPPET_AUTHORS" href="/authors/will-ing">Уилл Инг и др.</a>
    </div>
    <article>
      <a href="/audiobooks/SunPendulumAudio">Под маятником солнца</a>
      <a href="/authors/will-ing">Уилл Инг</a>
      <a href="/authors/others">др.</a>
    </article>
  `;

  assert.deepEqual(
    extractYandexBooksSearchResults(html, 'https://books.yandex.ru/search/all/test'),
    [
      {
        title: 'Под маятником солнца',
        authors: ['Уилл Инг'],
        url: 'https://books.yandex.ru/books/SunPendulum',
      },
      {
        title: 'Под маятником солнца',
        authors: ['Уилл Инг'],
        url: 'https://books.yandex.ru/audiobooks/SunPendulumAudio',
      },
    ],
  );
});

test('extracts Yandex Books search results from generic result cards', () => {
  const html = `
    <main>
      <article>
        <img alt="Галлант">
        <a href="/books/DLOkiLqz">Галлант</a>
        <a href="/authors/uWlVhSUW">Виктория Шваб</a>
      </article>
      <article>
        <a href="/audiobooks/meGR5b5P">
          <img alt="Галлант">
        </a>
        <a href="/authors/uWlVhSUW">Виктория Шваб</a>
      </article>
      <section>
        <a href="/bookshelves/top">Подборка</a>
      </section>
    </main>
  `;

  assert.deepEqual(
    extractYandexBooksSearchResults(html, 'https://books.yandex.ru/search/all/test'),
    [
      {
        title: 'Галлант',
        authors: ['Виктория Шваб'],
        url: 'https://books.yandex.ru/books/DLOkiLqz',
      },
      {
        title: 'Галлант',
        authors: ['Виктория Шваб'],
        url: 'https://books.yandex.ru/audiobooks/meGR5b5P',
      },
    ],
  );
});

test('matches Yandex Books result by similar title and author', () => {
  const book = {
    title: 'Сто лет одиночества',
    authors: ['Габриэль Гарсиа Маркес'],
  };

  assert.equal(
    isYandexBooksResultSimilarToBook(
      {
        title: 'Сто лет одиночества',
        authors: ['Габриэль Гарсиа Маркес'],
        url: 'https://books.yandex.ru/books/RuLNt8od',
      },
      book,
    ),
    true,
  );
  assert.equal(
    isYandexBooksResultSimilarToBook(
      {
        title: 'Сто лет одиночества. Полная версия',
        authors: ['Габриэль Гарсия Маркес'],
        url: 'https://books.yandex.ru/audiobooks/RuLNt8od',
      },
      book,
    ),
    true,
  );
  assert.equal(
    isYandexBooksResultSimilarToBook(
      {
        title: 'Полковнику никто не пишет',
        authors: ['Габриэль Гарсиа Маркес'],
        url: 'https://books.yandex.ru/books/Eyxip4ae',
      },
      book,
    ),
    false,
  );
  assert.equal(
    isYandexBooksResultSimilarToBook(
      {
        title: 'Сто лет одиночества',
        authors: ['Другой автор'],
        url: 'https://books.yandex.ru/books/Other',
      },
      book,
    ),
    false,
  );
});

test('matches Yandex Books author by initials and last name', () => {
  assert.equal(isSimilarYandexBooksAuthor('Виктория Шваб', 'В. Э. Шваб'), true);
  assert.equal(isSimilarYandexBooksAuthor('Виктория Шваб', 'В.Э.Шваб'), true);
  assert.equal(isSimilarYandexBooksAuthor('Виктория Шваб', 'В. Э. Иванова'), false);
});

test('matches Yandex Books result when author is abbreviated', () => {
  assert.equal(
    isYandexBooksResultSimilarToBook(
      {
        title: 'Галлант',
        authors: ['В. Э. Шваб'],
        url: 'https://books.yandex.ru/books/DLOkiLqz',
      },
      {
        title: 'Галлант',
        authors: ['Виктория Шваб'],
      },
    ),
    true,
  );
});

test('filters matching Yandex Books URLs for a source book', () => {
  const book = {
    title: 'Сто лет одиночества',
    authors: ['Габриэль Гарсиа Маркес'],
  };
  const results = [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://books.yandex.ru/books/RuLNt8od',
    },
    {
      title: 'Полковнику никто не пишет',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://books.yandex.ru/books/Eyxip4ae',
    },
    {
      title: 'Сто лет одиночества',
      authors: ['Другой автор'],
      url: 'https://books.yandex.ru/books/Other',
    },
    {
      title: '100 лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://books.yandex.ru/audiobooks/RuLNt8od',
    },
  ];

  assert.deepEqual(
    filterYandexBooksResultsForBook(results, book, { maxResults: 1 }),
    [results[0]],
  );
});

test('extracts only matching Yandex Books URLs from search HTML', () => {
  const html = `
    <div data-test-id="SNIPPET">
      <a href="/books/RuLNt8od">Сто лет одиночества</a>
      <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
    </div>
    <div data-test-id="SNIPPET">
      <a href="/books/Eyxip4ae">Полковнику никто не пишет</a>
      <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
    </div>
  `;

  assert.deepEqual(
    extractMatchingYandexBooksUrls(
      html,
      {
        title: 'Сто лет одиночества',
        authors: ['Габриэль Гарсиа Маркес'],
      },
      'https://books.yandex.ru/search/all/test',
    ),
    ['https://books.yandex.ru/books/RuLNt8od'],
  );
});

test('enriches books with matching Yandex Books URLs', async () => {
  const calls = [];
  const books = [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
    },
    {
      title: 'Полковнику никто не пишет',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/200000',
    },
  ];

  const enriched = await enrichBooksWithYandexBooksUrls(books, {
    profileDir: '.browser-profile-test',
    async fetchSearchPage(options) {
      calls.push(options);
      return {
        url: 'https://books.yandex.ru/search/all/test',
        html: `
          <div data-test-id="SNIPPET">
            <a href="/books/RuLNt8od">Сто лет одиночества</a>
            <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
          </div>
          <div data-test-id="SNIPPET">
            <a href="/books/Eyxip4ae">Полковнику никто не пишет</a>
            <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
          </div>
        `,
      };
    },
  });

  assert.deepEqual(
    calls.map((call) => [call.query, call.profileDir]),
    [
      ['Сто лет одиночества', '.browser-profile-test'],
      ['Полковнику никто не пишет', '.browser-profile-test'],
    ],
  );
  assert.deepEqual(enriched, [
    {
      ...books[0],
      yandex_books_urls: ['https://books.yandex.ru/books/RuLNt8od'],
    },
    {
      ...books[1],
      yandex_books_urls: ['https://books.yandex.ru/books/Eyxip4ae'],
    },
  ]);
});

test('limits matching Yandex Books URLs per book', async () => {
  const books = [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
    },
  ];

  const enriched = await enrichBooksWithYandexBooksUrls(books, {
    maxResults: 1,
    async fetchSearchPage() {
      return {
        url: 'https://books.yandex.ru/search/all/test',
        html: `
          <div data-test-id="SNIPPET">
            <a href="/books/RuLNt8od">Сто лет одиночества</a>
            <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
          </div>
          <div data-test-id="SNIPPET">
            <a href="/audiobooks/RuLNt8od">Сто лет одиночества. Полная версия</a>
            <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
          </div>
        `,
      };
    },
  });

  assert.deepEqual(enriched, [
    {
      ...books[0],
      yandex_books_urls: ['https://books.yandex.ru/books/RuLNt8od'],
    },
  ]);
});

test('preserves LiveLib fields while enriching Yandex Books URLs', async () => {
  const books = [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
      livelib_note: 'keep this field untouched',
      yandex_books_urls: ['https://books.yandex.ru/books/old'],
    },
  ];

  const enriched = await enrichBooksWithYandexBooksUrls(books, {
    async fetchSearchPage() {
      return {
        url: 'https://books.yandex.ru/search/all/test',
        html: `
          <div data-test-id="SNIPPET">
            <a href="/books/RuLNt8od">Сто лет одиночества</a>
            <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
          </div>
        `,
      };
    },
  });

  assert.deepEqual(enriched, [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
      livelib_note: 'keep this field untouched',
      yandex_books_urls: ['https://books.yandex.ru/books/RuLNt8od'],
    },
  ]);
  assert.deepEqual(books[0], {
    title: 'Сто лет одиночества',
    authors: ['Габриэль Гарсиа Маркес'],
    url: 'https://www.livelib.ru/book/100000',
    livelib_note: 'keep this field untouched',
    yandex_books_urls: ['https://books.yandex.ru/books/old'],
  });
});

test('reuses existing Yandex Books URLs and skips search for already enriched books', async () => {
  const calls = [];
  const books = [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
    },
    {
      title: 'Полковнику никто не пишет',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/200000',
    },
  ];

  const enriched = await enrichBooksWithYandexBooksUrls(books, {
    existingBooks: [
      {
        title: 'Old title should not be reused',
        authors: ['Old author'],
        url: 'https://www.livelib.ru/book/100000',
        yandex_books_urls: ['https://books.yandex.ru/books/existing'],
      },
    ],
    async fetchSearchPage({ query }) {
      calls.push(query);
      return {
        url: 'https://books.yandex.ru/search/all/test',
        html: `
          <div data-test-id="SNIPPET">
            <a href="/books/Eyxip4ae">Полковнику никто не пишет</a>
            <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
          </div>
        `,
      };
    },
  });

  assert.deepEqual(calls, ['Полковнику никто не пишет']);
  assert.deepEqual(enriched, [
    {
      ...books[0],
      yandex_books_urls: ['https://books.yandex.ru/books/existing'],
    },
    {
      ...books[1],
      yandex_books_urls: ['https://books.yandex.ru/books/Eyxip4ae'],
    },
  ]);
});

test('counts books with existing Yandex Books URLs', () => {
  const books = [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
    },
    {
      title: 'Полковнику никто не пишет',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/200000',
    },
    {
      title: 'В ночном саду',
      authors: ['Кэтрин М. Валенте'],
      url: 'https://www.livelib.ru/work/300000',
    },
  ];
  const existingBooks = [
    {
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: ['https://books.yandex.ru/books/existing'],
    },
    {
      url: 'https://www.livelib.ru/book/200000',
      yandex_books_urls: [],
    },
  ];

  assert.equal(countBooksWithExistingYandexBooksUrls(books, existingBooks), 1);
});

test('waits between Yandex Books searches', async () => {
  const calls = [];
  const sleeps = [];
  const books = [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
    },
    {
      title: 'Полковнику никто не пишет',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/200000',
    },
  ];

  await enrichBooksWithYandexBooksUrls(books, {
    delayMs: 2000,
    async sleep(ms) {
      sleeps.push(ms);
      calls.push(['sleep', ms]);
    },
    async fetchSearchPage({ query }) {
      calls.push(['fetch', query]);
      return {
        url: 'https://books.yandex.ru/search/all/test',
        html: '',
      };
    },
  });

  assert.deepEqual(sleeps, [2000]);
  assert.deepEqual(calls, [
    ['fetch', 'Сто лет одиночества'],
    ['sleep', 2000],
    ['fetch', 'Полковнику никто не пишет'],
  ]);
});

test('enriches missing Yandex Books matches with an empty URL array', async () => {
  const books = [
    {
      title: 'Редкая книга без совпадений',
      authors: ['Неизвестный автор'],
      url: 'https://www.livelib.ru/book/300000',
    },
  ];

  const enriched = await enrichBooksWithYandexBooksUrls(books, {
    async fetchSearchPage() {
      return {
        url: 'https://books.yandex.ru/search/all/test',
        html: `
          <div data-test-id="SNIPPET">
            <a href="/books/RuLNt8od">Сто лет одиночества</a>
            <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
          </div>
        `,
      };
    },
  });

  assert.deepEqual(enriched, [
    {
      ...books[0],
      yandex_books_urls: [],
    },
  ]);
});

test('keeps enriching after a failed Yandex Books search', async () => {
  const errors = [];
  const books = [
    {
      title: 'Контакт',
      authors: ['Карл Саган'],
      url: 'https://www.livelib.ru/book/100000',
    },
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/200000',
    },
  ];

  const enriched = await enrichBooksWithYandexBooksUrls(books, {
    async fetchSearchPage({ query }) {
      if (query === 'Контакт Саган') {
        throw new Error('page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE');
      }

      return {
        url: 'https://books.yandex.ru/search/all/test',
        html: `
          <div data-test-id="SNIPPET">
            <a href="/books/RuLNt8od">Сто лет одиночества</a>
            <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
          </div>
        `,
      };
    },
    onSearchError({ book, query, error }) {
      errors.push([book.title, query, error.message]);
    },
  });

  assert.deepEqual(errors, [[
    'Контакт',
    'Контакт Саган',
    'page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE',
  ]]);
  assert.deepEqual(enriched, [
    {
      ...books[0],
      yandex_books_urls: [],
    },
    {
      ...books[1],
      yandex_books_urls: ['https://books.yandex.ru/books/RuLNt8od'],
    },
  ]);
});
