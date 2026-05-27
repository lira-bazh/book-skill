import { appendFileSync } from 'node:fs';

import { cleanText, normalizeForMatch } from './text-match.mjs';

const AUTHOR_ET_AL_RE = /(?:^|[\s,;])и\s+др\.?$/iu;
const AUTHOR_SEPARATOR_RE = /\s*(?:[,;]|\s+[&+]\s+)\s*/u;
const TITLE_MATCH_STOP_RE = /[.:?]/u;
const SEARCH_MATCH_LOG_FILE = process.env.BOOK_SEARCH_MATCH_LOG_FILE ?? '/tmp/book-search-match.log';

export function isSearchResultSimilarToBook(result, book) {
  if (!isSearchResultTitleSimilarToBook(book?.title, result?.title)) {
    return false;
  }

  return hasMatchingAuthorLastName(book?.authors, result?.authors);
}

export function filterSearchResultsForBook(
  results,
  book,
  {
    maxResults = Infinity,
  } = {},
) {
  const matched = [];
  const seen = new Set();

  for (const result of results) {
    if (matched.length >= maxResults) {
      break;
    }

    if (!result?.url || seen.has(result.url)) {
      continue;
    }

    if (isSearchResultSimilarToBook(result, book)) {
      seen.add(result.url);
      matched.push(result);
    }
  }

  return matched;
}

function isSearchResultTitleSimilarToBook(sourceTitle, candidateTitle) {
  const source = normalizeForMatch(cleanText(String(sourceTitle ?? '').split(TITLE_MATCH_STOP_RE, 1)[0]));
  const candidate = normalizeForMatch(candidateTitle);
  logSearchMatchComparison(`compare title: "${source}" with "${candidate}"`);

  return Boolean(source && candidate && candidate.includes(source));
}

function hasMatchingAuthorLastName(sourceAuthors, candidateAuthors) {
  const sourceLastNames = authorLastNames(sourceAuthors);
  const candidateLastNames = authorLastNames(candidateAuthors);

  if (sourceLastNames.length === 0 || candidateLastNames.length === 0) {
    return false;
  }

  return sourceLastNames.some((sourceLastName) => (
    candidateLastNames.some((candidateLastName) => {
      logSearchMatchComparison(`compare author last name: "${sourceLastName}" with "${candidateLastName}"`);
      return sourceLastName === candidateLastName;
    })
  ));
}

function authorLastNames(authors) {
  return cleanValues(authors)
    .flatMap((author) => cleanText(author).replace(AUTHOR_ET_AL_RE, '').split(AUTHOR_SEPARATOR_RE))
    .map((author) => normalizeForMatch(author).split(' ').filter(Boolean).at(-1))
    .filter(Boolean);
}

function cleanValues(values) {
  return Array.isArray(values) ? values.filter((value) => cleanText(value)) : [];
}

function logSearchMatchComparison(message) {
  appendFileSync(SEARCH_MATCH_LOG_FILE, `${message}\n`, 'utf8');
}
