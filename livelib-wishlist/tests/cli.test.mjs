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

test('main waits between Yandex Books searches with yandex delay option', async (t) => {
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
      '--yandex-delay-ms',
      '42',
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
  assert.deepEqual(sleeps, [42]);
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
  assert.ok(logs.includes('Found Yandex Books links for 2 book(s)'));
  assert.ok(logs.includes('Skipped 1 book(s) with existing Yandex Books links'));
  assert.deepEqual(saved, [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
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
