import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { main } from '../scripts/livelib-wish-to-json.mjs';

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

test('main writes merged LiveLib updates back to the same output JSON', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'wishlist.json');
  t.mock.method(console, 'log', () => {});

  await writeFile(
    htmlPath,
    `
      <div class="brow-book">
        <a class="brow-book-name" href="/book/100000">Existing Book from LiveLib</a>
        <a class="brow-book-author" href="/author/1">Author One</a>
      </div>
      <div class="brow-book">
        <a class="brow-book-name" href="/book/200000">New Book</a>
        <a class="brow-book-author" href="/author/2">Author Two</a>
      </div>
    `,
    'utf8',
  );
  await writeFile(
    outPath,
    `${JSON.stringify([
      {
        title: 'Existing Book from file',
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
    ])}\n`,
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
  assert.deepEqual(saved, [
    {
      title: 'Existing Book from file',
      authors: ['Old Author One'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: ['https://books.yandex.ru/books/existing'],
    },
    {
      title: 'New Book',
      authors: ['Author Two'],
      url: 'https://www.livelib.ru/book/200000',
      yandex_books_urls: [],
    },
  ]);
});

test('main enriches LiveLib book page details before writing output JSON', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'wishlist.json');
  const calls = [];
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
    `,
    'utf8',
  );

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--html',
      htmlPath,
      '--out',
      outPath,
    ],
    {
      async bookPageFetcher({ url }) {
        calls.push(url);
        return {
          url,
          html: `
            <meta property="og:description" content="Book One description">
            <meta property="og:image" content="/covers/book-one.jpg">
          `,
        };
      },
      async bookPageSleep() {},
    },
  );
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, ['https://www.livelib.ru/book/100000']);
  assert.deepEqual(saved, [
    {
      title: 'Book One',
      authors: ['Author One'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: [],
      description: 'Book One description',
      image: 'https://www.livelib.ru/covers/book-one.jpg',
    },
  ]);
  assert.ok(logs.includes('Found LiveLib descriptions for 1 book(s)'));
  assert.ok(logs.includes('Found LiveLib images for 1 book(s)'));
  assert.ok(logs.includes('Enriched 1 book(s) with LiveLib descriptions'));
  assert.ok(logs.includes('Enriched 1 book(s) with LiveLib images'));
});

test('main checks output JSON before loading LiveLib HTML fallback', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const missingHtmlPath = join(directory, 'missing.html');
  const existingOutPath = join(directory, 'wishlist.json');
  await writeFile(existingOutPath, '[]\n', 'utf8');
  t.mock.method(console, 'error', () => {});

  const exitCode = await main([
    'https://www.livelib.ru/reader/LiraLantan/wish',
    '--html',
    missingHtmlPath,
    '--out',
    existingOutPath,
  ]);

  assert.equal(exitCode, 2);
});

test('main reads existing output JSON before loading LiveLib HTML fallback', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'wishlist.json');
  const errors = [];
  await writeFile(htmlPath, '<html>saved</html>', 'utf8');
  await writeFile(outPath, '{not json', 'utf8');
  t.mock.method(console, 'error', (message) => {
    errors.push(message);
  });

  const exitCode = await main([
    'https://www.livelib.ru/reader/LiraLantan/wish',
    '--html',
    htmlPath,
    '--out',
    outPath,
  ]);

  assert.equal(exitCode, 2);
  assert.match(errors[0], /^error: /);
});

test('main rejects invalid existing output JSON schema before loading LiveLib HTML fallback', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'wishlist.json');
  const errors = [];
  await writeFile(htmlPath, '<html>saved</html>', 'utf8');
  await writeFile(outPath, '{"books":[]}\n', 'utf8');
  t.mock.method(console, 'error', (message) => {
    errors.push(message);
  });

  const exitCode = await main([
    'https://www.livelib.ru/reader/LiraLantan/wish',
    '--html',
    htmlPath,
    '--out',
    outPath,
  ]);

  assert.equal(exitCode, 2);
  assert.deepEqual(errors, ['error: Existing JSON must contain an array']);
});

test('main saves matching Yandex Books URLs when enrichment is enabled', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'result', 'wishlist.json');
  const logs = [];
  t.mock.method(console, 'log', (message) => {
    logs.push(message);
  });

  await writeFile(
    htmlPath,
    `
      <div class="brow-book">
        <a class="brow-book-name" href="/book/100000">Сто лет одиночества</a>
        <a class="brow-book-author" href="/author/1">Габриэль Гарсиа Маркес</a>
      </div>
    `,
    'utf8',
  );

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--html',
      htmlPath,
      '--out',
      outPath,
      '--with-yandex-books',
    ],
    {
      async yandexSearchPageFetcher() {
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
    },
  );
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(exitCode, 0);
  assert.deepEqual(saved, [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: ['https://books.yandex.ru/books/RuLNt8od'],
    },
  ]);
  assert.ok(logs.includes('Found Yandex Books links for 1 book(s)'));
  assert.ok(logs.includes('Skipped 0 book(s) with existing Yandex Books links'));
});

test('main limits saved Yandex Books URLs with yandex max results option', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'result', 'wishlist.json');
  const logs = [];
  t.mock.method(console, 'log', (message) => {
    logs.push(message);
  });

  await writeFile(
    htmlPath,
    `
      <div class="brow-book">
        <a class="brow-book-name" href="/book/100000">Сто лет одиночества</a>
        <a class="brow-book-author" href="/author/1">Габриэль Гарсиа Маркес</a>
      </div>
    `,
    'utf8',
  );

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--html',
      htmlPath,
      '--out',
      outPath,
      '--with-yandex-books',
      '--yandex-max-results',
      '1',
    ],
    {
      async yandexSearchPageFetcher() {
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
    },
  );
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(exitCode, 0);
  assert.deepEqual(saved[0].yandex_books_urls, ['https://books.yandex.ru/books/RuLNt8od']);
});

test('main uses the fixed delay between Yandex Books searches', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'result', 'wishlist.json');
  const sleeps = [];
  t.mock.method(console, 'log', () => {});

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

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--html',
      htmlPath,
      '--out',
      outPath,
      '--with-yandex-books',
    ],
    {
      async yandexSearchPageFetcher() {
        return {
          url: 'https://books.yandex.ru/search/all/test',
          html: '',
        };
      },
      async yandexSleep(ms) {
        sleeps.push(ms);
      },
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(sleeps, [2000]);
});

test('main reports Yandex enrichment warnings and keeps writing output JSON', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'wishlist.json');
  const errors = [];
  t.mock.method(console, 'error', (message) => {
    errors.push(message);
  });
  t.mock.method(console, 'log', () => {});

  await writeFile(
    htmlPath,
    `
      <div class="brow-book">
        <a class="brow-book-name" href="/book/100000">Book One</a>
        <a class="brow-book-author" href="/author/1">Author One</a>
      </div>
    `,
    'utf8',
  );

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--html',
      htmlPath,
      '--out',
      outPath,
      '--with-yandex-books',
    ],
    {
      async yandexSearchPageFetcher() {
        throw new Error('Yandex timeout');
      },
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(errors, ['warning: skipped Yandex Books search for "Book One": Yandex timeout']);
  assert.deepEqual(JSON.parse(await readFile(outPath, 'utf8')), [
    {
      title: 'Book One',
      authors: ['Author One'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: [],
    },
  ]);
});

test('main reuses existing Yandex Books URLs and searches only missing books', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'result', 'wishlist.json');
  const calls = [];
  const logs = [];
  t.mock.method(console, 'log', (message) => {
    logs.push(message);
  });

  await writeFile(
    htmlPath,
    `
      <div class="brow-book">
        <a class="brow-book-name" href="/book/100000">Сто лет одиночества</a>
        <a class="brow-book-author" href="/author/1">Габриэль Гарсиа Маркес</a>
      </div>
      <div class="brow-book">
        <a class="brow-book-name" href="/book/200000">Полковнику никто не пишет</a>
        <a class="brow-book-author" href="/author/1">Габриэль Гарсиа Маркес</a>
      </div>
    `,
    'utf8',
  );
  await mkdir(join(directory, 'result'), { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify([
      {
        title: 'Old title',
        authors: ['Old author'],
        url: 'https://www.livelib.ru/book/100000',
        yandex_books_urls: ['https://books.yandex.ru/books/existing'],
      },
    ])}\n`,
    'utf8',
  );

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--html',
      htmlPath,
      '--out',
      outPath,
      '--with-yandex-books',
    ],
    {
      async yandexSearchPageFetcher({ query }) {
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
    },
  );
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, ['Полковнику никто не пишет Габриэль Гарсиа Маркес']);
  assert.ok(logs.includes('Loaded 1 existing book(s) from output JSON'));
  assert.ok(logs.includes('Found 2 book(s) on LiveLib'));
  assert.ok(logs.includes('Added 1 new LiveLib book(s)'));
  assert.ok(logs.includes('Found Yandex Books links for 2 book(s)'));
  assert.ok(logs.includes('Skipped 1 book(s) with existing Yandex Books links'));
  assert.ok(logs.includes('Enriched 1 book(s) with new Yandex Books links'));
  assert.deepEqual(saved, [
    {
      title: 'Old title',
      authors: ['Old author'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: ['https://books.yandex.ru/books/existing'],
    },
    {
      title: 'Полковнику никто не пишет',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/200000',
      yandex_books_urls: ['https://books.yandex.ru/books/Eyxip4ae'],
    },
  ]);
});

test('main updates only Yandex Books URLs for existing books after merge', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'result', 'wishlist.json');
  t.mock.method(console, 'log', () => {});

  await writeFile(
    htmlPath,
    `
      <div class="brow-book">
        <a class="brow-book-name" href="/book/100000">Сто лет одиночества from LiveLib</a>
        <a class="brow-book-author" href="/author/1">Габриэль Гарсиа Маркес</a>
      </div>
    `,
    'utf8',
  );
  await mkdir(join(directory, 'result'), { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify([
      {
        title: 'Сто лет одиночества from file',
        authors: ['Author from file'],
        url: 'https://www.livelib.ru/book/100000',
        livelib_note: 'keep me',
        yandex_books_urls: [],
      },
    ])}\n`,
    'utf8',
  );

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--html',
      htmlPath,
      '--out',
      outPath,
      '--with-yandex-books',
    ],
    {
      async yandexSearchPageFetcher() {
        return {
          url: 'https://books.yandex.ru/search/all/test',
          html: `
            <div data-test-id="SNIPPET">
              <a href="/books/RuLNt8od">Сто лет одиночества from file</a>
              <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Author from file</a>
            </div>
          `,
        };
      },
    },
  );
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(exitCode, 0);
  assert.deepEqual(saved, [
    {
      title: 'Сто лет одиночества from file',
      authors: ['Author from file'],
      url: 'https://www.livelib.ru/book/100000',
      livelib_note: 'keep me',
      yandex_books_urls: ['https://books.yandex.ru/books/RuLNt8od'],
    },
  ]);
});

test('main saves matching Litres URLs with injected fetcher', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const htmlPath = join(directory, 'wish.html');
  const outPath = join(directory, 'result', 'wishlist.json');
  const logs = [];
  t.mock.method(console, 'log', (message) => {
    logs.push(message);
  });

  await writeFile(
    htmlPath,
    `
      <div class="brow-book">
        <a class="brow-book-name" href="/book/100000">Сто лет одиночества</a>
        <a class="brow-book-author" href="/author/1">Габриэль Гарсиа Маркес</a>
      </div>
    `,
    'utf8',
  );

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--html',
      htmlPath,
      '--out',
      outPath,
      '--max-results',
      '1',
    ],
    {
      async litresSearchPageFetcher() {
        return {
          url: 'https://www.litres.ru/search/?q=test',
          html: `
            <article>
              <a href="/book/gabriel-garsia-markes/sto-let-odinochestva-123/">Сто лет одиночества</a>
              <a href="/author/gabriel-garsia-markes/">Габриэль Гарсиа Маркес</a>
            </article>
            <article>
              <a href="/audiobook/gabriel-garsia-markes/sto-let-odinochestva-456/">Сто лет одиночества. Полная версия</a>
              <a href="/author/gabriel-garsia-markes/">Габриэль Гарсиа Маркес</a>
            </article>
          `,
        };
      },
      async litresSleep() {},
    },
  );
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(exitCode, 0);
  assert.deepEqual(saved, [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: [],
      litres_urls: ['https://www.litres.ru/book/gabriel-garsia-markes/sto-let-odinochestva-123'],
    },
  ]);
  assert.ok(logs.includes('Found Litres links for 1 book(s)'));
  assert.ok(logs.includes('Skipped 0 book(s) with existing Litres links'));
  assert.ok(logs.includes('Enriched 1 book(s) with new Litres links'));
});

test('main browser workflow uses one shared browser session', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const outPath = join(directory, 'wishlist.json');
  const events = [];
  t.mock.method(console, 'log', () => {});

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--out',
      outPath,
    ],
    {
      async browserSessionRunner(options, callback) {
        events.push(['session', options.profileDir]);
        const session = {
          page: {
            url() {
              return 'https://www.litres.ru/';
            },
          },
          async fetchWishlistPages({ wishlistUrl }) {
            events.push(['wishlist', wishlistUrl.url]);
            return [{
              url: wishlistUrl.url,
              html: `
                <div class="brow-book">
                  <a class="brow-book-name" href="/book/100000">Сто лет одиночества</a>
                  <a class="brow-book-author" href="/author/1">Габриэль Гарсиа Маркес</a>
                </div>
              `,
            }];
          },
          async fetchYandexBooksSearchPage() {
            events.push(['yandex']);
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
          async openLitresHome() {
            events.push(['litres-home']);
          },
          async fetchLitresSearchPage() {
            events.push(['litres-search']);
            return {
              url: 'https://www.litres.ru/search/?q=test',
              html: `
                <article>
                  <a href="/book/gabriel-garsia-markes/sto-let-odinochestva-123/">Сто лет одиночества</a>
                  <a href="/author/gabriel-garsia-markes/">Габриэль Гарсиа Маркес</a>
                </article>
              `,
            };
          },
        };

        return callback(session);
      },
      async confirmLitresLogin() {
        events.push(['litres-confirm']);
      },
      async yandexSleep() {},
      async litresSleep() {},
    },
  );
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(exitCode, 0);
  assert.deepEqual(events, [
    ['session', undefined],
    ['wishlist', 'https://www.livelib.ru/reader/LiraLantan/wish'],
    ['yandex'],
    ['litres-home'],
    ['litres-confirm'],
    ['litres-search'],
  ]);
  assert.deepEqual(saved, [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: ['https://books.yandex.ru/books/RuLNt8od'],
      litres_urls: ['https://www.litres.ru/book/gabriel-garsia-markes/sto-let-odinochestva-123'],
    },
  ]);
});

test('main browser workflow keeps JSON read, session work, and JSON write order', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const outPath = join(directory, 'wishlist.json');
  const outputPath = resolve(outPath);
  const events = [];
  let savedBooks;
  t.mock.method(console, 'log', () => {});

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--out',
      outPath,
    ],
    {
      async booksJsonExistsFn(path) {
        events.push(['json-exists', path]);
        return true;
      },
      async loadBooksJsonIfExistsFn(path) {
        events.push(['json-read', path]);
        return [{
          title: 'Existing Title',
          authors: ['Existing Author'],
          url: 'https://www.livelib.ru/book/100000',
          keep: 'from-json',
          yandex_books_urls: [],
          litres_urls: [],
        }];
      },
      async browserSessionRunner(options, callback) {
        events.push(['session-open', options.profileDir]);
        const session = {
          page: {
            url() {
              return 'https://www.litres.ru/';
            },
          },
          async fetchWishlistPages({ wishlistUrl }) {
            events.push(['livelib', wishlistUrl.url]);
            return [{
              url: wishlistUrl.url,
              html: `
                <div class="brow-book">
                  <a class="brow-book-name" href="/book/100000">LiveLib Title</a>
                  <a class="brow-book-author" href="/author/1">LiveLib Author</a>
                </div>
              `,
            }];
          },
          async fetchYandexBooksSearchPage() {
            events.push(['yandex']);
            return {
              url: 'https://books.yandex.ru/search/all/test',
              html: `
                <div data-test-id="SNIPPET">
                  <a href="/books/RuLNt8od">Existing Title</a>
                  <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Existing Author</a>
                </div>
              `,
            };
          },
          async openLitresHome() {
            events.push(['litres-home']);
          },
          async fetchLitresSearchPage() {
            events.push(['litres']);
            return {
              url: 'https://www.litres.ru/search/?q=test',
              html: `
                <article>
                  <a href="/audiobook/existing-author/existing-title-123/">Existing Title</a>
                  <a href="/author/existing-author/">Existing Author</a>
                </article>
              `,
            };
          },
          async fetchAudiobookPage({ url }) {
            events.push(['details-audio', url]);
            return {
              url,
              html: '<html><body>1 ч 20 мин</body></html>',
            };
          },
          async fetchBookPage({ url }) {
            events.push(['details-book', url]);
            return {
              url,
              html: `
                <html>
                  <head>
                    <meta property="og:description" content="Existing description">
                    <meta property="og:image" content="/covers/existing.jpg">
                  </head>
                </html>
              `,
            };
          },
        };

        return callback(session);
      },
      async confirmLitresLogin() {
        events.push(['litres-confirm']);
      },
      async writeBooksJsonFn(path, books) {
        events.push(['json-write', path]);
        savedBooks = books;
        return outputPath;
      },
      async yandexSleep() {},
      async litresSleep() {},
      async audiobookSleep() {},
      async bookPageSleep() {},
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(events, [
    ['json-exists', outPath],
    ['json-read', outPath],
    ['session-open', undefined],
    ['livelib', 'https://www.livelib.ru/reader/LiraLantan/wish'],
    ['yandex'],
    ['litres-home'],
    ['litres-confirm'],
    ['litres'],
    ['details-audio', 'https://www.litres.ru/audiobook/existing-author/existing-title-123'],
    ['details-book', 'https://www.livelib.ru/book/100000'],
    ['json-write', outPath],
  ]);
  assert.deepEqual(savedBooks, [
    {
      title: 'Existing Title',
      authors: ['Existing Author'],
      url: 'https://www.livelib.ru/book/100000',
      keep: 'from-json',
      yandex_books_urls: ['https://books.yandex.ru/books/RuLNt8od'],
      litres_urls: ['https://www.litres.ru/audiobook/existing-author/existing-title-123'],
      audiobook_duration_minutes: 80,
      description: 'Existing description',
      image: 'https://www.livelib.ru/covers/existing.jpg',
    },
  ]);
});
