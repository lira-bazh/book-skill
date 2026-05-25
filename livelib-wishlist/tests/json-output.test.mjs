import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadHtmlFile, writeBooksJson } from '../scripts/lib/json-output.mjs';

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
