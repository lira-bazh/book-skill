import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBookSearchQuery } from '../scripts/lib/book-search-query.mjs';

test('builds shared book search query from title only', () => {
  assert.equal(
    buildBookSearchQuery({
      title: '  Сто   лет   одиночества ',
      authors: [' Габриэль Гарсиа Маркес '],
    }),
    'Сто лет одиночества',
  );
});

test('builds shared book search query from title before punctuation', () => {
  assert.equal(
    buildBookSearchQuery({
      title: 'Понедельник начинается в субботу. Сказка для научных работников',
      authors: ['Аркадий Стругацкий', 'Борис Стругацкий'],
    }),
    'Понедельник начинается в субботу',
  );

  assert.equal(
    buildBookSearchQuery({
      title: 'Дюна: Мессия Дюны',
      authors: ['Фрэнк Герберт'],
    }),
    'Дюна Герберт',
  );

  assert.equal(
    buildBookSearchQuery({
      title: 'Кто?',
      authors: ['Алджис Будрис'],
    }),
    'Кто Будрис',
  );
});

test('adds first author last name to one-word or two-word title', () => {
  assert.equal(
    buildBookSearchQuery({
      title: 'Солярис',
      authors: ['Станислав Лем', 'Другой Автор'],
    }),
    'Солярис Лем',
  );

  assert.equal(
    buildBookSearchQuery({
      title: 'Темная башня',
      authors: ['Стивен Кинг'],
    }),
    'Темная башня Кинг',
  );
});

test('builds empty shared book search query without title', () => {
  assert.equal(buildBookSearchQuery({ authors: ['Габриэль Гарсиа Маркес'] }), '');
});
