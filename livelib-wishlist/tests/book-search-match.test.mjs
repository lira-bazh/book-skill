import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterSearchResultsForBook,
  isSearchResultSimilarToBook,
} from '../scripts/lib/book-search-match.mjs';

test('matches search result by title prefix and any author last name', () => {
  assert.equal(
    isSearchResultSimilarToBook(
      {
        title: 'Book One. Extended Edition',
        authors: ['Another Author', 'Writer Two'],
      },
      {
        title: 'Book One',
        authors: ['Author One', 'Author Two'],
      },
    ),
    true,
  );
});

test('rejects search result when source book has no authors', () => {
  assert.equal(
    isSearchResultSimilarToBook(
      { title: 'Book One', authors: [] },
      { title: 'Book One' },
    ),
    false,
  );
});

test('rejects search result without matching author when source has authors', () => {
  assert.equal(
    isSearchResultSimilarToBook(
      { title: 'Book One', authors: [] },
      { title: 'Book One', authors: ['Author One'] },
    ),
    false,
  );
});

test('rejects search result when source title prefix is absent from candidate title', () => {
  assert.equal(
    isSearchResultSimilarToBook(
      { title: 'Book One', authors: ['Author One'] },
      { title: 'Other Volume', authors: ['Author One'] },
    ),
    false,
  );
});

test('matches search result by source title before colon or question mark', () => {
  assert.equal(
    isSearchResultSimilarToBook(
      { title: 'Дюна: Мессия Дюны', authors: ['Фрэнк Герберт'] },
      { title: 'Дюна', authors: ['Фрэнк Герберт'] },
    ),
    true,
  );

  assert.equal(
    isSearchResultSimilarToBook(
      { title: 'Кто? Роман', authors: ['Алджис Будрис'] },
      { title: 'Кто', authors: ['Алджис Будрис'] },
    ),
    true,
  );
});

test('filters matching search results by URL uniqueness and max results', () => {
  const results = [
    { title: 'Book One', authors: ['Author One'], url: 'https://example.com/one' },
    { title: 'Book One', authors: ['Author One'], url: 'https://example.com/one' },
    { title: 'Book One', authors: ['Author One'], url: 'https://example.com/two' },
    { title: 'Other Book', authors: ['Author One'], url: 'https://example.com/three' },
  ];

  assert.deepEqual(
    filterSearchResultsForBook(
      results,
      { title: 'Book One', authors: ['Author One'] },
      { maxResults: 2 },
    ),
    [
      { title: 'Book One', authors: ['Author One'], url: 'https://example.com/one' },
      { title: 'Book One', authors: ['Author One'], url: 'https://example.com/two' },
    ],
  );
});
