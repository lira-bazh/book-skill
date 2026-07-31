import { cleanText, stripParentheticalText } from '../core/text-match.mjs';

type BookSearchQueryBook = {
  title?: string | null;
  authors?: readonly (string | null | undefined)[] | null;
} | null | undefined;

const TITLE_QUERY_STOP_RE = /[.:?]/u;

export function buildBookSearchQuery(book: BookSearchQueryBook): string {
  const title = cleanText(stripParentheticalText(book?.title).split(TITLE_QUERY_STOP_RE, 1)[0]);
  if (!title || !needsAuthorLastName(title)) {
    return title;
  }

  return cleanText([title, firstAuthorLastName(book)].filter(Boolean).join(' '));
}

function needsAuthorLastName(value: string): boolean {
  const wordCount = cleanText(value).split(/\s+/u).filter(Boolean).length;
  return wordCount > 0 && wordCount <= 2;
}

function firstAuthorLastName(book: BookSearchQueryBook): string {
  if (!Array.isArray(book?.authors) || book.authors.length === 0) {
    return '';
  }

  return cleanText(book.authors[0]).split(/\s+/u).filter(Boolean).at(-1) ?? '';
}
