import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_LITRES_RESULTS_WAIT_TIMEOUT_MS,
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  fetchBookPageWithBrowser,
  fetchLitresSearchPageWithBrowser,
  fetchWishlistPagesWithBrowser,
  fetchYandexBooksSearchPageWithBrowser,
  resolveProfileDir,
  withBrowserSession,
  withLitresSearchBrowserSession,
} from '../scripts/lib/browser.mjs';
import { LiveLibAccessError } from '../scripts/lib/livelib.mjs';

test('browser mode opens Yandex Books search page with persistent profile', async () => {
  const calls = [];
  let closed = false;
  let currentUrl = 'about:blank';

  const fakePage = {
    async goto(url, options) {
      currentUrl = url;
      calls.push(['goto', url, options]);
    },
    async waitForLoadState(state, options) {
      calls.push(['waitForLoadState', state, options]);
    },
    async waitForFunction(callback, arg, options) {
      calls.push(['waitForFunction', typeof callback, arg, options]);
    },
    url() {
      return currentUrl;
    },
    async content() {
      return '<html><body>yandex search</body></html>';
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext(profileDir, options) {
        calls.push(['launchPersistentContext', profileDir, options]);
        return {
          pages() {
            return [fakePage];
          },
          async close() {
            closed = true;
          },
        };
      },
    },
  };

  const result = await fetchYandexBooksSearchPageWithBrowser({
    query: 'Сто лет одиночества Маркес',
    profileDir: '.browser-profile-test',
    playwright: fakePlaywright,
  });
  const openedUrl = new URL(result.url);

  assert.equal(result.query, 'Сто лет одиночества Маркес');
  assert.equal(result.html, '<html><body>yandex search</body></html>');
  assert.equal(calls[0][0], 'launchPersistentContext');
  assert.match(calls[0][1], /\.browser-profile-test$/);
  assert.deepEqual(calls[0][2], { headless: false });
  assert.deepEqual(calls[1][2], {
    waitUntil: 'domcontentloaded',
    timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
  });
  assert.equal(openedUrl.origin, 'https://books.yandex.ru');
  assert.equal(
    decodeURIComponent(openedUrl.pathname),
    '/search/all/Сто лет одиночества Маркес',
  );
  assert.equal(openedUrl.search, '');
  assert.equal(closed, true);
});

test('browser mode retries transient Yandex Books navigation errors', async () => {
  const visited = [];
  let closed = false;
  let currentUrl = 'about:blank';

  const fakePage = {
    async goto(url) {
      visited.push(url);
      if (visited.length === 1) {
        throw new Error('page.goto: net::ERR_NETWORK_CHANGED');
      }
      currentUrl = url;
    },
    url() {
      return currentUrl;
    },
    async content() {
      return '<html><body>yandex search after retry</body></html>';
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext() {
        return {
          pages() {
            return [fakePage];
          },
          async close() {
            closed = true;
          },
        };
      },
    },
  };

  const result = await fetchYandexBooksSearchPageWithBrowser({
    query: 'Стальные боги Замиль Ахтар',
    playwright: fakePlaywright,
  });

  assert.equal(visited.length, 2);
  assert.equal(result.html, '<html><body>yandex search after retry</body></html>');
  assert.equal(closed, true);
});

test('browser mode opens Litres search page with persistent profile', async () => {
  const calls = [];
  let closed = false;
  let currentUrl = 'about:blank';

  const fakePage = {
    async goto(url, options) {
      currentUrl = url;
      calls.push(['goto', url, options]);
    },
    async waitForLoadState(state, options) {
      calls.push(['waitForLoadState', state, options]);
    },
    async waitForFunction(callback, arg, options) {
      calls.push(['waitForFunction', typeof callback, arg, options]);
    },
    url() {
      return currentUrl;
    },
    async content() {
      return '<html><body>litres search</body></html>';
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext(profileDir, options) {
        calls.push(['launchPersistentContext', profileDir, options]);
        return {
          pages() {
            return [fakePage];
          },
          async close() {
            closed = true;
          },
        };
      },
    },
  };

  const result = await fetchLitresSearchPageWithBrowser({
    query: 'Сто лет одиночества Маркес',
    profileDir: '.browser-profile-test',
    playwright: fakePlaywright,
  });
  const openedUrl = new URL(result.url);

  assert.equal(result.query, 'Сто лет одиночества Маркес');
  assert.equal(result.html, '<html><body>litres search</body></html>');
  assert.equal(calls[0][0], 'launchPersistentContext');
  assert.match(calls[0][1], /\.browser-profile-test$/);
  assert.deepEqual(calls[0][2], { headless: false });
  assert.deepEqual(calls[1][2], {
    waitUntil: 'domcontentloaded',
    timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
  });
  assert.deepEqual(calls[2], [
    'waitForLoadState',
    'networkidle',
    { timeout: DEFAULT_LITRES_RESULTS_WAIT_TIMEOUT_MS },
  ]);
  assert.deepEqual(calls[3], [
    'waitForFunction',
    'function',
    undefined,
    { timeout: DEFAULT_LITRES_RESULTS_WAIT_TIMEOUT_MS },
  ]);
  assert.equal(openedUrl.origin, 'https://www.litres.ru');
  assert.equal(openedUrl.pathname, '/search/');
  assert.equal(openedUrl.searchParams.get('q'), 'Сто лет одиночества Маркес');
  assert.equal(closed, true);
});

test('browser session opens one context and reuses one page for all fetchers', async () => {
  const visited = [];
  let launchCount = 0;
  let newPageCount = 0;
  let closed = false;
  let currentUrl = 'about:blank';

  const fakePage = {
    async goto(url) {
      currentUrl = url;
      visited.push(url);
    },
    async waitForLoadState() {},
    async waitForFunction() {},
    url() {
      return currentUrl;
    },
    async content() {
      if (currentUrl === 'https://www.livelib.ru/reader/LiraLantan/wish') {
        return '<a class="brow-book-name" href="/book/100000">Book One</a>';
      }
      return `<html><body>${currentUrl}</body></html>`;
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext() {
        launchCount += 1;
        return {
          pages() {
            return [fakePage];
          },
          async newPage() {
            newPageCount += 1;
            return fakePage;
          },
          async close() {
            closed = true;
          },
        };
      },
    },
  };

  const result = await withBrowserSession({ playwright: fakePlaywright }, async (session) => {
    assert.equal(session.page, fakePage);

    const wishlistPages = await session.fetchWishlistPages({
      wishlistUrl: {
        username: 'LiraLantan',
        url: 'https://www.livelib.ru/reader/LiraLantan/wish',
      },
      maxPages: 1,
    });
    const yandexPage = await session.fetchYandexBooksSearchPage({
      query: 'Book One Author One',
    });
    await session.openLitresHome();
    const litresPage = await session.fetchLitresSearchPage({
      query: 'Book One Author One',
    });
    const bookPage = await session.fetchBookPage({
      url: 'https://www.livelib.ru/book/100000',
    });

    return { wishlistPages, yandexPage, litresPage, bookPage };
  });

  assert.equal(launchCount, 1);
  assert.equal(newPageCount, 0);
  assert.equal(closed, true);
  assert.deepEqual(visited, [
    'https://www.livelib.ru/reader/LiraLantan/wish',
    'https://books.yandex.ru/search/all/Book%20One%20Author%20One',
    'https://www.litres.ru/',
    'https://www.litres.ru/search/?q=Book+One+Author+One',
    'https://www.livelib.ru/book/100000',
  ]);
  assert.equal(result.wishlistPages.length, 1);
  assert.equal(
    result.yandexPage.url,
    'https://books.yandex.ru/search/all/Book%20One%20Author%20One',
  );
  assert.equal(
    result.litresPage.url,
    'https://www.litres.ru/search/?q=Book+One+Author+One',
  );
  assert.equal(result.bookPage.url, 'https://www.livelib.ru/book/100000');
});

test('browser mode opens LiveLib book page with persistent profile', async () => {
  const calls = [];
  let closed = false;
  let currentUrl = 'about:blank';

  const fakePage = {
    async goto(url, options) {
      currentUrl = url;
      calls.push(['goto', url, options]);
    },
    url() {
      return currentUrl;
    },
    async content() {
      return '<html><body>book page</body></html>';
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext(profileDir, options) {
        calls.push(['launchPersistentContext', profileDir, options]);
        return {
          pages() {
            return [fakePage];
          },
          async close() {
            closed = true;
          },
        };
      },
    },
  };

  const result = await fetchBookPageWithBrowser({
    url: 'https://www.livelib.ru/book/100000-title?utm_source=list#reviews',
    profileDir: '.browser-profile-test',
    playwright: fakePlaywright,
  });

  assert.equal(result.url, 'https://www.livelib.ru/book/100000-title');
  assert.equal(result.html, '<html><body>book page</body></html>');
  assert.equal(calls[0][0], 'launchPersistentContext');
  assert.match(calls[0][1], /\.browser-profile-test$/);
  assert.deepEqual(calls[0][2], { headless: false });
  assert.deepEqual(calls[1], [
    'goto',
    'https://www.livelib.ru/book/100000-title',
    {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
    },
  ]);
  assert.equal(closed, true);
});

test('browser mode rejects non-book LiveLib page for book page fetcher', async () => {
  const fakePlaywright = {
    chromium: {
      async launchPersistentContext() {
        return {
          pages() {
            return [
              {
                async goto() {},
                url() {
                  return 'about:blank';
                },
                async content() {
                  return '';
                },
              },
            ];
          },
          async close() {},
        };
      },
    },
  };

  await assert.rejects(
    () => fetchBookPageWithBrowser({
      url: 'https://www.livelib.ru/reader/LiraLantan/wish',
      playwright: fakePlaywright,
    }),
    /Book page URL must be a LiveLib book or work URL/,
  );
});

test('browser session closes context when a fetcher throws', async () => {
  let closed = false;
  const fakePage = {
    async goto() {
      throw new Error('search failed');
    },
    url() {
      return 'about:blank';
    },
    async content() {
      return '';
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext() {
        return {
          pages() {
            return [fakePage];
          },
          async close() {
            closed = true;
          },
        };
      },
    },
  };

  await assert.rejects(
    () => withBrowserSession({ playwright: fakePlaywright }, async (session) => {
      await session.fetchYandexBooksSearchPage({
        query: 'Book One Author One',
      });
    }),
    /search failed/,
  );
  assert.equal(closed, true);
});

test('Litres browser session reuses one persistent context for multiple searches', async () => {
  const visited = [];
  const confirmations = [];
  let launchCount = 0;
  let closed = false;
  let currentUrl = 'about:blank';

  const fakePage = {
    async goto(url) {
      currentUrl = url;
      visited.push(url);
    },
    async waitForLoadState() {},
    async waitForFunction() {},
    url() {
      return currentUrl;
    },
    async content() {
      return `<html><body>${currentUrl}</body></html>`;
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext() {
        launchCount += 1;
        return {
          pages() {
            return [fakePage];
          },
          async close() {
            closed = true;
          },
        };
      },
    },
  };

  const result = await withLitresSearchBrowserSession(
    {
      playwright: fakePlaywright,
      async onBeforeSearch({ pageUrl }) {
        confirmations.push(pageUrl);
      },
    },
    async ({ fetchSearchPage }) => [
      await fetchSearchPage({ query: 'Book One Author One' }),
      await fetchSearchPage({ query: 'Book Two Author Two' }),
    ],
  );

  assert.equal(launchCount, 1);
  assert.equal(visited.length, 3);
  assert.equal(visited[0], 'https://www.litres.ru/');
  assert.deepEqual(confirmations, ['https://www.litres.ru/']);
  assert.equal(new URL(visited[1]).searchParams.get('q'), 'Book One Author One');
  assert.equal(new URL(visited[2]).searchParams.get('q'), 'Book Two Author Two');
  assert.equal(result.length, 2);
  assert.equal(closed, true);
});

test('default persistent profile lives in the skill directory', () => {
  const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  assert.equal(resolveProfileDir(), join(skillDir, '.browser-profile'));
});

test('browser mode opens wishlist page with persistent profile', async () => {
  const calls = [];
  let closed = false;
  let currentUrl = 'about:blank';

  const fakePage = {
    async goto(url, options) {
      currentUrl = url;
      calls.push(['goto', url, options]);
    },
    url() {
      return currentUrl;
    },
    async content() {
      return '<html><body>wishlist</body></html>';
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext(profileDir, options) {
        calls.push(['launchPersistentContext', profileDir, options]);
        return {
          pages() {
            return [fakePage];
          },
          async close() {
            closed = true;
          },
        };
      },
    },
  };

  const result = await fetchWishlistPagesWithBrowser({
    wishlistUrl: {
      username: 'LiraLantan',
      url: 'https://www.livelib.ru/reader/LiraLantan/wish',
    },
    maxPages: 1,
    profileDir: '.browser-profile-test',
    playwright: fakePlaywright,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://www.livelib.ru/reader/LiraLantan/wish');
  assert.equal(result[0].html, '<html><body>wishlist</body></html>');
  assert.equal(calls[0][0], 'launchPersistentContext');
  assert.match(calls[0][1], /\.browser-profile-test$/);
  assert.deepEqual(calls[0][2], { headless: false });
  assert.deepEqual(calls[1], [
    'goto',
    'https://www.livelib.ru/reader/LiraLantan/wish',
    {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
    },
  ]);
  assert.equal(closed, true);
});

test('browser mode uses default persistent profile when no profile dir is provided', async () => {
  let profilePath;
  let currentUrl = 'about:blank';

  const fakePage = {
    async goto(url) {
      currentUrl = url;
    },
    url() {
      return currentUrl;
    },
    async content() {
      return '<html><body>wishlist</body></html>';
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext(profileDir) {
        profilePath = profileDir;
        return {
          pages() {
            return [fakePage];
          },
          async close() {},
        };
      },
    },
  };

  await fetchWishlistPagesWithBrowser({
    wishlistUrl: {
      username: 'LiraLantan',
      url: 'https://www.livelib.ru/reader/LiraLantan/wish',
    },
    maxPages: 1,
    playwright: fakePlaywright,
  });

  assert.equal(profilePath, resolveProfileDir());
});

test('browser mode opens every real wishlist pagination page once', async () => {
  const visited = [];
  let currentUrl = 'about:blank';
  const pagesByUrl = new Map([
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      `
        <a href="/reader/LiraLantan/wish?page=2">2</a>
        <a href="/reader/LiraLantan/wish?page=2">duplicate 2</a>
        <a href="/reader/LiraLantan/wish/listview/smalllist/~3">3</a>
        <a href="/reader/LiraLantan/wish?page=3&utm_source=footer">tracking</a>
        <a href="/reader/LiraLantan/read?page=2">read</a>
      `,
    ],
    [
      'https://www.livelib.ru/reader/LiraLantan/wish?page=2',
      `
        <a href="/reader/LiraLantan/wish?page=1">1</a>
        <a href="/reader/LiraLantan/wish?page=2">duplicate current</a>
        <a href="/reader/OtherUser/wish?page=3">other</a>
      `,
    ],
    [
      'https://www.livelib.ru/reader/LiraLantan/wish/listview/smalllist/~3',
      '<a href="/reader/LiraLantan/wish/listview/smalllist/~2">2</a>',
    ],
  ]);

  const fakePage = {
    async goto(url) {
      currentUrl = url;
      visited.push(url);
    },
    url() {
      return currentUrl;
    },
    async content() {
      return pagesByUrl.get(currentUrl) ?? '';
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext() {
        return {
          pages() {
            return [fakePage];
          },
          async close() {},
        };
      },
    },
  };

  const result = await fetchWishlistPagesWithBrowser({
    wishlistUrl: {
      username: 'LiraLantan',
      url: 'https://www.livelib.ru/reader/LiraLantan/wish',
    },
    maxPages: 50,
    playwright: fakePlaywright,
  });

  assert.deepEqual(visited, [
    'https://www.livelib.ru/reader/LiraLantan/wish',
    'https://www.livelib.ru/reader/LiraLantan/wish?page=2',
    'https://www.livelib.ru/reader/LiraLantan/wish/listview/smalllist/~3',
  ]);
  assert.deepEqual(result.map((page) => page.url), visited);
});

test('browser mode rejects unexpected LiveLib pages before returning partial data', async () => {
  let closed = false;
  const fakePage = {
    async goto() {},
    url() {
      return 'https://www.livelib.ru/service/ratelimitcaptcha';
    },
    async content() {
      return '<html>rate limit</html>';
    },
  };

  const fakePlaywright = {
    chromium: {
      async launchPersistentContext() {
        return {
          pages() {
            return [fakePage];
          },
          async close() {
            closed = true;
          },
        };
      },
    },
  };

  await assert.rejects(
    () => fetchWishlistPagesWithBrowser({
      wishlistUrl: {
        username: 'LiraLantan',
        url: 'https://www.livelib.ru/reader/LiraLantan/wish',
      },
      playwright: fakePlaywright,
    }),
    LiveLibAccessError,
  );
  assert.equal(closed, true);
});
