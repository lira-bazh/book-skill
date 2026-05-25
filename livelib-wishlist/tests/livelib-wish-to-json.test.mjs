import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  extractWishlistPageUrls,
  fetchWishlistPagesWithBrowser,
  loadHtmlFile,
  normalizeWishlistPageUrl,
  parseLivelibWishlistUrl,
  resolveProfileDir,
} from '../scripts/livelib-wish-to-json.mjs';

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
  ]);
});

test('loads saved HTML file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  const htmlPath = join(directory, 'wish.html');
  await writeFile(htmlPath, '<html>saved</html>', 'utf8');

  const result = await loadHtmlFile(htmlPath);

  assert.equal(result.url, htmlPath);
  assert.equal(result.html, '<html>saved</html>');
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
    { waitUntil: 'domcontentloaded' },
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
