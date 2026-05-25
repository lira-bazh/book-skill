import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  extractBooks,
  extractBooksFromPages,
  extractBookUrls,
  extractBookUrlsFromPages,
  extractWishlistPageUrls,
  fetchWishlistPagesWithBrowser,
  loadHtmlFile,
  main,
  normalizeBookUrl,
  normalizeWishlistPageUrl,
  parseLivelibWishlistUrl,
  resolveProfileDir,
  writeBooksJson,
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

test('normalizes only LiveLib book URLs', () => {
  const baseUrl = 'https://www.livelib.ru/reader/LiraLantan/wish';

  assert.equal(
    normalizeBookUrl('/book/100000', baseUrl),
    'https://www.livelib.ru/book/100000',
  );
  assert.equal(
    normalizeBookUrl('https://www.livelib.ru/book/100000?utm_source=list#reviews', baseUrl),
    'https://www.livelib.ru/book/100000',
  );

  const rejectedUrls = [
    '/reader/LiraLantan/wish',
    '/bookseries/100000',
    '/book/100000/readers',
    '/book/100000/reviews-title',
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
        <a class="brow-book-author" href="/author/2">Author Two</a>
        <a class="brow-book-author" href="/author/2">Author Two</a>
        <a href="/book/100000-title/reviews">10 reviews</a>
      </div>
    </div>
  `;

  assert.deepEqual(extractBooks(html, 'https://www.livelib.ru/reader/LiraLantan/wish'), [
    {
      title: 'The First Book',
      authors: ['Author One', 'Author Two'],
      url: 'https://www.livelib.ru/book/100000-title',
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

test('loads saved HTML file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  await writeFile(htmlPath, '<html>saved</html>', 'utf8');

  const result = await loadHtmlFile(htmlPath);

  assert.equal(result.url, htmlPath);
  assert.equal(result.html, '<html>saved</html>');
});

test('writes extracted books to JSON file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const outPath = join(directory, 'nested', 'wishlist.json');
  const books = [
    {
      title: 'Book One',
      authors: ['Author One'],
      url: 'https://www.livelib.ru/book/100000',
    },
  ];

  const resultPath = await writeBooksJson(outPath, books);
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(resultPath, outPath);
  assert.deepEqual(saved, books);
});

test('main reports output path, book count, and processed page count', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'result', 'wishlist.json');
  const outputPath = resolve(outPath);
  const logs = [];
  t.mock.method(console, 'log', (message) => {
    logs.push(message);
  });

  await writeFile(
    htmlPath,
    `
      <div class="brow-book">
        <a class="brow-book-name" href="/book/100000">Book One</a>
        <a class="brow-book-author" href="/author/1">Author One</a>
      </div>
      <div class="brow-book">
        <a class="brow-book-name" href="/book/200000">Book Two</a>
        <a class="brow-book-author" href="/author/2">Author Two</a>
      </div>
    `,
    'utf8',
  );

  const exitCode = await main([
    'https://www.livelib.ru/reader/LiraLantan/wish',
    '--html',
    htmlPath,
    '--out',
    outPath,
  ]);
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(exitCode, 0);
  assert.equal(saved.length, 2);
  assert.ok(logs.includes('Loaded 1 HTML page(s)'));
  assert.ok(logs.includes('Found 2 book(s)'));
  assert.ok(logs.includes(`Output path: ${outputPath}`));
  assert.ok(logs.includes(`Saved 2 book(s) from 1 page(s) to ${outputPath}`));
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
