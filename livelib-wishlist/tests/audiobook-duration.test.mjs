import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enrichBooksWithAudiobookDuration,
  extractAudiobookDurationMinutes,
  firstAudiobookUrlForBook,
  hasRecordedAudiobookDuration,
  isAudiobookUrl,
  parseAudiobookDurationMinutes,
} from '../scripts/lib/audiobook-duration.mjs';

test('detects audiobook URLs by URL text', () => {
  assert.equal(
    isAudiobookUrl('https://books.yandex.ru/audiobooks/DdVH9BNW'),
    true,
  );
  assert.equal(
    isAudiobookUrl('https://www.litres.ru/audiobook/author/title-123'),
    true,
  );
  assert.equal(
    isAudiobookUrl('https://example.com/AUDIOBOOK/title'),
    true,
  );

  assert.equal(isAudiobookUrl('https://books.yandex.ru/books/DdVH9BNW'), false);
  assert.equal(isAudiobookUrl('https://www.litres.ru/book/author/title-123'), false);
  assert.equal(isAudiobookUrl(''), false);
  assert.equal(isAudiobookUrl(null), false);
});

test('parses audiobook duration text to minutes', () => {
  assert.equal(parseAudiobookDurationMinutes('8 ч 35 мин'), 515);
  assert.equal(parseAudiobookDurationMinutes('8 часов 35 минут'), 515);
  assert.equal(parseAudiobookDurationMinutes('35 мин'), 35);
  assert.equal(parseAudiobookDurationMinutes('1 ч'), 60);
  assert.equal(parseAudiobookDurationMinutes('2 часа'), 120);
  assert.equal(parseAudiobookDurationMinutes('21 минута'), 21);
  assert.equal(parseAudiobookDurationMinutes('4 минуты'), 4);
  assert.equal(parseAudiobookDurationMinutes('  3   ч.   7   мин.  '), 187);
});

test('returns null when audiobook duration text is missing', () => {
  assert.equal(parseAudiobookDurationMinutes(''), null);
  assert.equal(parseAudiobookDurationMinutes('слушать фрагмент'), null);
  assert.equal(parseAudiobookDurationMinutes(null), null);
});

test('finds first audiobook URL for a book', () => {
  assert.equal(
    firstAudiobookUrlForBook({
      yandex_books_urls: [
        'https://books.yandex.ru/books/RuLNt8od',
        'https://books.yandex.ru/audiobooks/DdVH9BNW',
      ],
      litres_urls: [
        'https://www.litres.ru/audiobook/author/title-123',
      ],
    }),
    'https://books.yandex.ru/audiobooks/DdVH9BNW',
  );

  assert.equal(
    firstAudiobookUrlForBook({
      yandex_books_urls: ['https://books.yandex.ru/books/RuLNt8od'],
      litres_urls: ['https://www.litres.ru/book/author/title-123'],
    }),
    null,
  );
});

test('detects recorded audiobook duration', () => {
  assert.equal(hasRecordedAudiobookDuration({ audiobook_duration_minutes: 515 }), true);
  assert.equal(hasRecordedAudiobookDuration({ audiobook_duration_minutes: 0 }), true);
  assert.equal(hasRecordedAudiobookDuration({ audiobook_duration_minutes: null }), false);
  assert.equal(hasRecordedAudiobookDuration({}), false);
});

test('extracts audiobook duration from page HTML', () => {
  assert.equal(
    extractAudiobookDurationMinutes(`
      <html>
        <body>
          <section>
            <h2>Аудиокнига</h2>
            <p>Длительность: 8 часов 35 минут</p>
          </section>
        </body>
      </html>
    `),
    515,
  );
  assert.equal(extractAudiobookDurationMinutes('<html><body>Нет длительности</body></html>'), null);
});

test('enriches only books with audiobook URL and without recorded duration', async () => {
  const calls = [];
  const books = [
    {
      title: 'Already enriched',
      audiobook_duration_minutes: 120,
      yandex_books_urls: ['https://books.yandex.ru/audiobooks/existing'],
    },
    {
      title: 'No audiobook',
      yandex_books_urls: ['https://books.yandex.ru/books/plain'],
    },
    {
      title: 'Needs duration',
      yandex_books_urls: [
        'https://books.yandex.ru/books/plain',
        'https://books.yandex.ru/audiobooks/needed',
      ],
    },
    {
      title: 'Missing duration',
      litres_urls: ['https://www.litres.ru/audiobook/author/missing-123'],
    },
  ];

  const enriched = await enrichBooksWithAudiobookDuration(books, {
    fetchAudiobookPage: async ({ url }) => {
      calls.push(url);
      return {
        url,
        html: url.includes('missing')
          ? '<html><body>Слушать фрагмент</body></html>'
          : '<html><body>8 ч 35 мин</body></html>',
      };
    },
  });

  assert.deepEqual(calls, [
    'https://books.yandex.ru/audiobooks/needed',
    'https://www.litres.ru/audiobook/author/missing-123',
  ]);
  assert.equal(enriched[0].audiobook_duration_minutes, 120);
  assert.equal('audiobook_duration_minutes' in enriched[1], false);
  assert.equal(enriched[2].audiobook_duration_minutes, 515);
  assert.equal('audiobook_duration_minutes' in enriched[3], false);
});
