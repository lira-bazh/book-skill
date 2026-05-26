import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { main } from '../scripts/livelib-wish-to-json.mjs';

test('main enriches audiobook duration after finding audiobook links', async (t) => {
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
    ],
    {
      async yandexSearchPageFetcher() {
        calls.push('yandex');
        return {
          url: 'https://books.yandex.ru/search/all/test',
          html: `
            <div data-test-id="SNIPPET">
              <a href="/audiobooks/RuLNt8od">Сто лет одиночества</a>
              <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
            </div>
          `,
        };
      },
      async audiobookPageFetcher({ url }) {
        calls.push(`audiobook:${url}`);
        return {
          url,
          html: '<html><body>Длительность: 8 ч 35 мин</body></html>',
        };
      },
      yandexSleep: async () => {},
      audiobookSleep: async () => {},
    },
  );
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    'yandex',
    'audiobook:https://books.yandex.ru/audiobooks/RuLNt8od',
  ]);
  assert.deepEqual(saved, [
    {
      title: 'Сто лет одиночества',
      authors: ['Габриэль Гарсиа Маркес'],
      url: 'https://www.livelib.ru/book/100000',
      yandex_books_urls: ['https://books.yandex.ru/audiobooks/RuLNt8od'],
      audiobook_duration_minutes: 515,
    },
  ]);
  assert.ok(logs.includes('Found audiobook links for 1 book(s)'));
  assert.ok(logs.includes('Enriched 1 book(s) with audiobook duration'));
});

test('main enriches audiobook duration in the standard browser workflow', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'livelib-wishlist-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const outPath = join(directory, 'wishlist.json');
  const calls = [];
  t.mock.method(console, 'log', () => {});

  const exitCode = await main(
    [
      'https://www.livelib.ru/reader/LiraLantan/wish',
      '--out',
      outPath,
    ],
    {
      async browserSessionRunner(options, callback) {
        calls.push('browser-session');
        return callback({
          page: {
            url() {
              return 'https://www.litres.ru/';
            },
          },
          async fetchWishlistPages() {
            calls.push('livelib');
            return [{
              url: 'https://www.livelib.ru/reader/LiraLantan/wish',
              html: `
                <div class="brow-book">
                  <a class="brow-book-name" href="/book/100000">Сто лет одиночества</a>
                  <a class="brow-book-author" href="/author/1">Габриэль Гарсиа Маркес</a>
                </div>
              `,
            }];
          },
          async fetchYandexBooksSearchPage() {
            calls.push('yandex');
            return {
              url: 'https://books.yandex.ru/search/all/test',
              html: `
                <div data-test-id="SNIPPET">
                  <a href="/audiobooks/RuLNt8od">Сто лет одиночества</a>
                  <a data-test-id="SNIPPET_AUTHORS" href="/authors/mtCiHlg1">Габриэль Гарсиа Маркес</a>
                </div>
              `,
            };
          },
          async openLitresHome() {
            calls.push('litres-home');
          },
          async fetchLitresSearchPage() {
            calls.push('litres');
            return {
              url: 'https://www.litres.ru/search/?q=test',
              html: '<html><body>No matches</body></html>',
            };
          },
          async fetchAudiobookPage({ url }) {
            calls.push(`audiobook:${url}`);
            return {
              url,
              html: '<html><body>Длительность: 8 часов 35 минут</body></html>',
            };
          },
        });
      },
      async confirmLitresLogin() {
        calls.push('confirm-litres');
      },
      yandexSleep: async () => {},
      litresSleep: async () => {},
      audiobookSleep: async () => {},
    },
  );
  const saved = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    'browser-session',
    'livelib',
    'yandex',
    'litres-home',
    'confirm-litres',
    'litres',
    'audiobook:https://books.yandex.ru/audiobooks/RuLNt8od',
  ]);
  assert.equal(saved[0].audiobook_duration_minutes, 515);
});
