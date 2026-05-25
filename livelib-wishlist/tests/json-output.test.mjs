import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadBooksJsonIfExists, loadHtmlFile, writeBooksJson } from '../scripts/lib/json-output.mjs';

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

test('loads existing books JSON when it exists', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const outPath = join(directory, 'wishlist.json');
  const books = [
    {
      title: 'Book One',
      authors: ['Author One'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: ['https://books.yandex.ru/books/one'],
    },
  ];
  await writeFile(outPath, `${JSON.stringify(books)}\n`, 'utf8');

  assert.deepEqual(await loadBooksJsonIfExists(outPath), books);
});

test('loads an empty books array when JSON does not exist', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  assert.deepEqual(await loadBooksJsonIfExists(join(directory, 'missing.json')), []);
});
