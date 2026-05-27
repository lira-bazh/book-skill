import { cleanText } from './text-match.mjs';

const TITLE_QUERY_STOP_RE = /[.:?]/u;

export function buildBookSearchQuery(book) {
  const title = cleanText(String(book?.title ?? '').split(TITLE_QUERY_STOP_RE, 1)[0]);
  if (!title || !needsAuthorLastName(title)) {
    return title;
  }

  return cleanText([title, firstAuthorLastName(book)].filter(Boolean).join(' '));
}

function needsAuthorLastName(value) {
  const wordCount = cleanText(value).split(/\s+/u).filter(Boolean).length;
  return wordCount > 0 && wordCount <= 2;
}

function firstAuthorLastName(book) {
  if (!Array.isArray(book?.authors) || book.authors.length === 0) {
    return '';
  }

  return cleanText(book.authors[0]).split(/\s+/u).filter(Boolean).at(-1) ?? '';
}
