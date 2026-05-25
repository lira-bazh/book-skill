import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildYandexBooksSearchQuery,
  buildYandexBooksSearchUrl,
  enrichBooksWithYandexBooksUrls,
  extractMatchingYandexBooksUrls,
  extractYandexBooksSearchResults,
  extractYandexBooksUrls,
  filterYandexBooksResultsForBook,
  isYandexBooksResultSimilarToBook,
  normalizeYandexBooksUrl,
} from '../scripts/lib/yandex-books.mjs';

test('builds Yandex Books search query from title and authors', () => {
  assert.equal(
    buildYandexBooksSearchQuery({
      title: '  Сто   лет   одиночества ',
      authors: [' Габриэль Гарсиа Маркес ', 'Габриэль Гарсиа Маркес'],
    }),
    'Сто лет одиночества Габриэль Гарсиа Маркес',
  );
});

test('builds Yandex Books search query without authors', () => {
  assert.equal(
    buildYandexBooksSearchQuery({
      title: 'В ночном саду',
      authors: [],
    }),
    'В ночном саду',
  );
});

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
      ['Сто лет одиночества Габриэль Гарсиа Маркес', '.browser-profile-test'],
      ['Полковнику никто не пишет Габриэль Гарсиа Маркес', '.browser-profile-test'],
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
