import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLitresSearchQuery,
  buildLitresSearchUrl,
  countBooksWithExistingLitresUrls,
  enrichBooksWithLitresUrls,
  extractLitresSearchResults,
  extractLitresUrls,
  extractMatchingLitresUrls,
  filterLitresResultsForBook,
  isLitresResultSimilarToBook,
  normalizeLitresUrl,
} from '../scripts/lib/litres-books.mjs';

test('builds Litres search query from title and authors', () => {
  assert.equal(
    buildLitresSearchQuery({
      title: '  Сто   лет   одиночества ',
      authors: [' Габриэль Гарсиа Маркес ', 'Габриэль Гарсиа Маркес'],
    }),
    'Сто лет одиночества Габриэль Гарсиа Маркес',
  );
});

test('builds Litres search URL', () => {
  const searchUrl = new URL(buildLitresSearchUrl(' Сто лет одиночества  Маркес '));

  assert.equal(searchUrl.origin, 'https://www.litres.ru');
  assert.equal(searchUrl.pathname, '/search/');
  assert.equal(searchUrl.searchParams.get('q'), 'Сто лет одиночества Маркес');
});

test('rejects empty Litres search query', () => {
  assert.throws(() => buildLitresSearchUrl('   '));
});

test('normalizes only Litres book and audiobook URLs', () => {
  const baseUrl = 'https://www.litres.ru/search/?q=test';

  assert.equal(
    normalizeLitresUrl('/book/gabriel-garsia-markes/sto-let-odinochestva-123/'),
    'https://www.litres.ru/book/gabriel-garsia-markes/sto-let-odinochestva-123',
  );
  assert.equal(
    normalizeLitresUrl('/audiobook/gabriel-garsia-markes/sto-let-odinochestva-123/?utm=test#fragment'),
    'https://www.litres.ru/audiobook/gabriel-garsia-markes/sto-let-odinochestva-123',
  );
  assert.equal(
    normalizeLitresUrl('https://litres.ru/book/gabriel-garsia-markes/sto-let-odinochestva-123/', baseUrl),
    'https://www.litres.ru/book/gabriel-garsia-markes/sto-let-odinochestva-123',
  );

  const rejectedUrls = [
    '/book',
    '/author/gabriel-garsia-markes/',
    '/search/?q=test',
    'https://example.com/book/gabriel-garsia-markes/sto-let-odinochestva-123/',
    'mailto:test@example.com',
  ];

  for (const url of rejectedUrls) {
    assert.equal(normalizeLitresUrl(url, baseUrl), null);
  }
});

test('extracts unique Litres book URLs from HTML', () => {
  const html = `
    <a href="/book/gabriel-garsia-markes/sto-let-odinochestva-123/">Сто лет одиночества</a>
    <a href="/book/gabriel-garsia-markes/sto-let-odinochestva-123/?utm=duplicate">duplicate</a>
    <a href="/audiobook/gabriel-garsia-markes/sto-let-odinochestva-456/">Сто лет одиночества</a>
    <a href="/author/gabriel-garsia-markes/">author</a>
  `;

  assert.deepEqual(
    extractLitresUrls(html, 'https://www.litres.ru/search/?q=test'),
    [
      'https://www.litres.ru/book/gabriel-garsia-markes/sto-let-odinochestva-123',
      'https://www.litres.ru/audiobook/gabriel-garsia-markes/sto-let-odinochestva-456',
    ],
  );
});

test('extracts Litres search results with title, authors, and URL', () => {
  const html = `
    <article>
      <a href="/book/gabriel-garsia-markes/sto-let-odinochestva-123/">
        Сто лет одиночества
      </a>
      <a href="/author/gabriel-garsia-markes/">Габриэль Гарсиа Маркес</a>
    </article>
    <article>
      <a href="/book/gabriel-garsia-markes/sto-let-odinochestva-123/?utm=duplicate">
        Duplicate
      </a>
      <a href="/author/gabriel-garsia-markes/">Габриэль Гарсиа Маркес</a>
    </article>
    <article>
      <a href="/audiobook/gabriel-garsia-markes/uvidimsya-v-avguste-456/" title="Увидимся в августе">
        Купить
      </a>
      <a href="/author/gabriel-garsia-markes/">Габриэль Гарсиа Маркес</a>
    </article>
  `;

  assert.deepEqual(
    extractLitresSearchResults(html, 'https://www.litres.ru/search/?q=test'),
    [
      {
        title: 'Сто лет одиночества',
        authors: ['Габриэль Гарсиа Маркес'],
        url: 'https://www.litres.ru/book/gabriel-garsia-markes/sto-let-odinochestva-123',
      },
      {
        title: 'Увидимся в августе',
        authors: ['Габриэль Гарсиа Маркес'],
        url: 'https://www.litres.ru/audiobook/gabriel-garsia-markes/uvidimsya-v-avguste-456',
      },
    ],
  );
});

test('extracts Litres search result when cover or action link appears before title link', () => {
  const html = `
    <article>
      <a href="/book/gabriel-garsia-markes/sto-let-odinochestva-123/">Купить</a>
      <a href="/author/gabriel-garsia-markes/">Габриэль Гарсиа Маркес</a>
      <a href="/book/gabriel-garsia-markes/sto-let-odinochestva-123/" data-testid="book-title">
        Сто лет одиночества
      </a>
    </article>
  `;

  assert.deepEqual(
    extractLitresSearchResults(html, 'https://www.litres.ru/search/?q=test'),
    [
      {
        title: 'Сто лет одиночества',
        authors: ['Габриэль Гарсиа Маркес'],
        url: 'https://www.litres.ru/book/gabriel-garsia-markes/sto-let-odinochestva-123',
      },
    ],
  );
});

test('matches Litres result by similar title and author', () => {
  const book = {
    title: 'Сто лет одиночества',
    authors: ['Габриэль Гарсиа Маркес'],
  };

  assert.equal(
    isLitresResultSimilarToBook(
      {
        title: 'Сто лет одиночества',
        authors: ['Габриэль Гарсиа Маркес'],
      },
      book,
    ),
    true,
  );
  assert.equal(
    isLitresResultSimilarToBook(
      {
        title: 'Сто лет одиночества. Полная версия',
        authors: ['Габриэль Гарсия Маркес'],
      },
      book,
    ),
    true,
  );
  assert.equal(
    isLitresResultSimilarToBook(
      {
        title: 'Полковнику никто не пишет',
        authors: ['Габриэль Гарсиа Маркес'],
      },
      book,
    ),
    false,
  );
  assert.equal(
    isLitresResultSimilarToBook(
      {
        title: 'Сто лет одиночества',
        authors: ['Другой автор'],
      },
      book,
    ),
    false,
  );
});

test('matches Litres result when source title has collection format note', () => {
  const book = {
    title: 'История моей жизни (сборник)',
    authors: ['Хелен Келлер'],
  };

  assert.equal(
    isLitresResultSimilarToBook(
      {
        title: 'История моей жизни. Открывая мир движениями пальцев',
        authors: ['Хелен Келлер'],
      },
      book,
    ),
    true,
  );
});

test('matches Litres result when candidate author is shortened with et al marker', () => {
  const book = {
    title: 'Как говорить, чтобы дети слушали, и как слушать, чтобы дети говорили',
    authors: ['Адель Фабер, Элейн Мазлиш'],
  };

  assert.equal(
    isLitresResultSimilarToBook(
      {
        title: 'Как говорить, чтобы дети слушали, и как слушать, чтобы дети говорили',
        authors: ['Элейн Мазлиш и др.'],
      },
      book,
    ),
    true,
  );
});

test('filters matching Litres URLs for a source book', () => {
  const book = {
    title: 'Сто лет одиночества',
    authors: ['Габриэль Гарсиа Маркес'],
  };
  const results = [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.litres.ru/book/gabriel-garsia-markes/sto-let-odinochestva-123',
    },
    {
      title: 'Полковнику никто не пишет',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.litres.ru/book/gabriel-garsia-markes/polkovniku-nikto-ne-pishet-456',
    },
    {
      title: 'Сто лет одиночества',
      authors: ['Другой автор'],
      url: 'https://www.litres.ru/book/other/sto-let-odinochestva-789',
    },
  ];

  assert.deepEqual(
    filterLitresResultsForBook(results, book, { maxResults: 1 }),
    [results[0]],
  );
});

test('extracts only matching Litres URLs from search HTML', () => {
  const html = `
    <article>
      <a href="/book/gabriel-garsia-markes/sto-let-odinochestva-123/">Сто лет одиночества</a>
      <a href="/author/gabriel-garsia-markes/">Габриэль Гарсиа Маркес</a>
    </article>
    <article>
      <a href="/book/gabriel-garsia-markes/polkovniku-nikto-ne-pishet-456/">Полковнику никто не пишет</a>
      <a href="/author/gabriel-garsia-markes/">Габриэль Гарсиа Маркес</a>
    </article>
  `;

  assert.deepEqual(
    extractMatchingLitresUrls(
      html,
      {
        title: 'Сто лет одиночества',
        authors: ['Габриэль Гарсиа Маркес'],
      },
      'https://www.litres.ru/search/?q=test',
    ),
    ['https://www.litres.ru/book/gabriel-garsia-markes/sto-let-odinochestva-123'],
  );
});

test('enriches books with Litres URLs and reuses existing links', async () => {
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
  const calls = [];

  const enriched = await enrichBooksWithLitresUrls(books, {
    existingBooks: [
      {
        url: 'https://www.livelib.ru/book/100000',
        litres_urls: ['https://www.litres.ru/book/existing/sto-let-odinochestva-123'],
      },
    ],
    async fetchSearchPage({ query }) {
      calls.push(query);
      return {
        url: 'https://www.litres.ru/search/?q=test',
        html: `
          <article>
            <a href="/book/gabriel-garsia-markes/polkovniku-nikto-ne-pishet-456/">Полковнику никто не пишет</a>
            <a href="/author/gabriel-garsia-markes/">Габриэль Гарсиа Маркес</a>
          </article>
        `,
      };
    },
    maxResults: 1,
    sleep: async () => {},
  });

  assert.deepEqual(calls, ['Полковнику никто не пишет Габриэль Гарсиа Маркес']);
  assert.deepEqual(enriched, [
    {
      ...books[0],
      litres_urls: ['https://www.litres.ru/book/existing/sto-let-odinochestva-123'],
    },
    {
      ...books[1],
      litres_urls: ['https://www.litres.ru/book/gabriel-garsia-markes/polkovniku-nikto-ne-pishet-456'],
    },
  ]);
});

test('counts books with existing Litres URLs', () => {
  assert.equal(
    countBooksWithExistingLitresUrls(
      [
        { url: 'https://www.livelib.ru/book/100000' },
        { url: 'https://www.livelib.ru/book/200000' },
      ],
      [
        {
          url: 'https://www.livelib.ru/book/100000',
          litres_urls: ['https://www.litres.ru/book/existing/one'],
        },
        {
          url: 'https://www.livelib.ru/book/200000',
          litres_urls: [],
        },
      ],
    ),
    1,
  );
});
