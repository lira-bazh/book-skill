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
});

test('extracts wishlist pagination links without duplicates', () => {
  const html = `
    <a href="/reader/LiraLantan/wish?page=2">2</a>
    <a href="https://www.livelib.ru/reader/LiraLantan/wish?page=3">3</a>
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
