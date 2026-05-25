import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
});
