import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  fetchLitresSearchPageWithBrowser,
  fetchWishlistPagesWithBrowser,
  fetchYandexBooksSearchPageWithBrowser,
  resolveProfileDir,
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
  assert.equal(openedUrl.origin, 'https://www.litres.ru');
  assert.equal(openedUrl.pathname, '/search/');
  assert.equal(openedUrl.searchParams.get('q'), 'Сто лет одиночества Маркес');
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
