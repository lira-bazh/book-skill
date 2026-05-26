#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';

import {
  enrichBooksWithAudiobookDuration,
  firstAudiobookUrlForBook,
  hasRecordedAudiobookDuration,
} from './lib/audiobook-duration.mjs';
import {
  DEFAULT_MAX_PAGES,
  fetchYandexBooksSearchPageWithBrowser,
  withBrowserSession,
  withLitresSearchBrowserSession,
} from './lib/browser.mjs';
import {
  booksJsonExists,
  loadBooksJsonIfExists,
  loadHtmlFile,
  writeBooksJson,
} from './lib/json-output.mjs';
import {
  extractBooksFromPages,
  matchBooksByLiveLibUrl,
  mergeExistingLiveLibBooks,
  parseLivelibWishlistUrl,
} from './lib/livelib.mjs';
import {
  countBooksWithExistingLitresUrls,
  enrichBooksWithLitresUrls,
} from './lib/litres-books.mjs';
import {
  countBooksWithExistingYandexBooksUrls,
  enrichBooksWithYandexBooksUrls,
} from './lib/yandex-books.mjs';

const DEFAULT_MAX_RESULTS = 5;
const FIXED_REQUEST_DELAY_MS = 2000;

function hasYandexBooksUrls(book) {
  return Array.isArray(book?.yandex_books_urls) && book.yandex_books_urls.length > 0;
}

function hasLitresUrls(book) {
  return Array.isArray(book?.litres_urls) && book.litres_urls.length > 0;
}

function parseArgs(argv) {
  const args = {
    out: 'wishlist.json',
    html: null,
    maxPages: DEFAULT_MAX_PAGES,
    profileDir: undefined,
    maxResults: DEFAULT_MAX_RESULTS,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    } else if (arg === '--out') {
      args.out = argv[++i];
    } else if (arg === '--html') {
      args.html = argv[++i];
    } else if (arg === '--max-pages') {
      args.maxPages = Number.parseInt(argv[++i], 10);
    } else if (arg === '--profile-dir') {
      args.profileDir = argv[++i];
    } else if (arg === '--max-results' || arg === '--yandex-max-results') {
      args.maxResults = Number.parseInt(argv[++i], 10);
    } else if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else {
      positional.push(arg);
    }
  }

  args.url = positional[0];
  return args;
}

function printHelp() {
  const scriptPath = process.argv[1]?.endsWith('livelib-wish-to-json.mjs')
    ? process.argv[1]
    : 'livelib-wishlist/scripts/livelib-wish-to-json.mjs';

  console.log(`Usage:
  node ${scriptPath} <url> --out wishlist.json --max-pages 50
  node ${scriptPath} <url> --html wish_page.html --out wishlist.json

Options:
  --profile-dir <path>     Persistent browser profile directory. Default: livelib-wishlist/.browser-profile
  --html <path>            Fallback: load a saved HTML file.
  --out <path>             Output JSON path. Default: wishlist.json
  --max-pages <number>     Maximum pagination pages. Default: ${DEFAULT_MAX_PAGES}
  Request delay is fixed at ${FIXED_REQUEST_DELAY_MS} ms for LiveLib pagination, Yandex Books searches, and Litres searches.
  Browser workflow searches matching books on Yandex Books and Litres automatically.
  --max-results <n>       Maximum matching URLs per book for each search enrichment. Default: ${DEFAULT_MAX_RESULTS}
`);
}

async function waitForLitresLoginConfirmation({ input = process.stdin, output = process.stdout } = {}) {
  const readline = createInterface({ input, output });
  try {
    await readline.question(
      'Litres is open in the browser. Sign in manually if needed, then press Enter here to continue...',
    );
  } finally {
    readline.close();
  }
}

export async function main(
  argv = process.argv.slice(2),
  {
    yandexSearchPageFetcher,
    yandexSleep,
    litresSearchPageFetcher,
    litresSleep,
    audiobookPageFetcher,
    audiobookSleep,
    confirmLitresLogin = waitForLitresLoginConfirmation,
    browserSessionRunner = withBrowserSession,
    withLitresSearchSession = withLitresSearchBrowserSession,
    booksJsonExistsFn = booksJsonExists,
    loadBooksJsonIfExistsFn = loadBooksJsonIfExists,
    writeBooksJsonFn = writeBooksJson,
  } = {},
) {
  const args = parseArgs(argv);

  if (args.help || !args.url) {
    printHelp();
    return args.help ? 0 : 2;
  }

  if (!Number.isInteger(args.maxResults) || args.maxResults < 1) {
    console.error('error: --max-results must be a positive integer');
    return 2;
  }
  let wishlistUrl;
  try {
    wishlistUrl = parseLivelibWishlistUrl(args.url);
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 2;
  }

  let outputJsonExists;
  let existingBooks = [];
  try {
    outputJsonExists = await booksJsonExistsFn(args.out);
    if (outputJsonExists) {
      existingBooks = await loadBooksJsonIfExistsFn(args.out);
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 2;
  }

  let fetchedPages;
  let livelibBooks;
  let livelibMatch;
  let books;
  let skippedYandexBooks = 0;
  let enrichedYandexBooks = 0;
  let skippedLitres = 0;
  let enrichedLitres = 0;
  let ranAudiobookDurationEnrichment = false;
  let skippedAudiobookDuration = 0;
  let enrichedAudiobookDuration = 0;
  let outputPath;

  const finishWorkflow = async ({ nextFetchedPages, browserSession = null }) => {
    fetchedPages = nextFetchedPages;
    livelibBooks = extractBooksFromPages(fetchedPages);
    livelibMatch = matchBooksByLiveLibUrl(livelibBooks, existingBooks);
    books = mergeExistingLiveLibBooks(livelibBooks, existingBooks);
    const shouldEnrichYandexBooks = Boolean(browserSession) || typeof yandexSearchPageFetcher === 'function';
    const shouldEnrichLitres = Boolean(browserSession) || typeof litresSearchPageFetcher === 'function';
    const fetchAudiobookPage = audiobookPageFetcher ?? browserSession?.fetchAudiobookPage;
    const shouldEnrichAudiobookDuration = typeof fetchAudiobookPage === 'function';

    if (shouldEnrichYandexBooks) {
      const yandexUrlsBeforeEnrichment = new Map(
        books.map((book) => [book.url, hasYandexBooksUrls(book)]),
      );
      skippedYandexBooks = countBooksWithExistingYandexBooksUrls(books, books);
      books = await enrichBooksWithYandexBooksUrls(books, {
        existingBooks: books,
        fetchSearchPage: yandexSearchPageFetcher
          ?? browserSession?.fetchYandexBooksSearchPage
          ?? fetchYandexBooksSearchPageWithBrowser,
        profileDir: args.profileDir,
        maxResults: args.maxResults,
        delayMs: FIXED_REQUEST_DELAY_MS,
        onSearchError({ book, error }) {
          console.error(`warning: skipped Yandex Books search for "${book.title}": ${error.message}`);
        },
        sleep: yandexSleep,
      });
      enrichedYandexBooks = books.filter((book) => (
        !yandexUrlsBeforeEnrichment.get(book.url) && hasYandexBooksUrls(book)
      )).length;
    }

    if (shouldEnrichLitres) {
      const litresUrlsBeforeEnrichment = new Map(
        books.map((book) => [book.url, hasLitresUrls(book)]),
      );
      skippedLitres = countBooksWithExistingLitresUrls(books, books);

      const enrichWithLitres = async (fetchSearchPage) => {
        books = await enrichBooksWithLitresUrls(books, {
          existingBooks: books,
          fetchSearchPage,
          profileDir: args.profileDir,
          maxResults: args.maxResults,
          delayMs: FIXED_REQUEST_DELAY_MS,
          onSearchError({ book, error }) {
            console.error(`warning: skipped Litres search for "${book.title}": ${error.message}`);
          },
          sleep: litresSleep,
        });
      };

      if (litresSearchPageFetcher) {
        await enrichWithLitres(litresSearchPageFetcher);
      } else if (browserSession) {
        await browserSession.openLitresHome();
        await confirmLitresLogin({
          pageUrl: browserSession.page.url(),
        });
        await enrichWithLitres(browserSession.fetchLitresSearchPage);
      } else {
        await withLitresSearchSession({
          profileDir: args.profileDir,
          onBeforeSearch: confirmLitresLogin,
        }, async ({ fetchSearchPage }) => {
          await enrichWithLitres(fetchSearchPage);
        });
      }

      enrichedLitres = books.filter((book) => (
        !litresUrlsBeforeEnrichment.get(book.url) && hasLitresUrls(book)
      )).length;
    }

    if (shouldEnrichAudiobookDuration) {
      ranAudiobookDurationEnrichment = true;
      const audiobookDurationBeforeEnrichment = new Map(
        books.map((book) => [book.url, hasRecordedAudiobookDuration(book)]),
      );
      skippedAudiobookDuration = books.filter(hasRecordedAudiobookDuration).length;
      books = await enrichBooksWithAudiobookDuration(books, {
        fetchAudiobookPage,
        pageDelayMs: FIXED_REQUEST_DELAY_MS,
        onFetchError({ book, error }) {
          console.error(`warning: skipped audiobook duration for "${book.title}": ${error.message}`);
        },
        sleep: audiobookSleep,
      });
      enrichedAudiobookDuration = books.filter((book) => (
        !audiobookDurationBeforeEnrichment.get(book.url) && hasRecordedAudiobookDuration(book)
      )).length;
    }

    outputPath = await writeBooksJsonFn(args.out, books);
  };

  try {
    if (args.html) {
      const savedPage = await loadHtmlFile(args.html);
      await finishWorkflow({
        nextFetchedPages: [{ url: wishlistUrl.url, html: savedPage.html }],
      });
    } else {
      await browserSessionRunner({ profileDir: args.profileDir }, async (browserSession) => {
        const nextFetchedPages = await browserSession.fetchWishlistPages({
          wishlistUrl,
          maxPages: args.maxPages,
          pageDelayMs: FIXED_REQUEST_DELAY_MS,
        });
        await finishWorkflow({ nextFetchedPages, browserSession });
      });
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 2;
  }
  const shouldEnrichYandexBooks = !args.html || typeof yandexSearchPageFetcher === 'function';
  const shouldEnrichLitres = !args.html || typeof litresSearchPageFetcher === 'function';

  console.log(`Accepted LiveLib wish-list URL for user ${wishlistUrl.username}: ${wishlistUrl.url}`);
  console.log(`Loaded ${fetchedPages.length} HTML page(s)`);
  console.log(`Found ${books.length} book(s)`);
  console.log(`Loaded ${existingBooks.length} existing book(s) from output JSON`);
  console.log(`Found ${livelibBooks.length} book(s) on LiveLib`);
  console.log(`Added ${livelibMatch.newBooks.length} new LiveLib book(s)`);
  if (shouldEnrichYandexBooks) {
    const booksWithYandexUrls = books.filter((book) => hasYandexBooksUrls(book)).length;
    console.log(`Found Yandex Books links for ${booksWithYandexUrls} book(s)`);
    console.log(`Skipped ${skippedYandexBooks} book(s) with existing Yandex Books links`);
    console.log(`Enriched ${enrichedYandexBooks} book(s) with new Yandex Books links`);
  }
  if (shouldEnrichLitres) {
    const booksWithLitresUrls = books.filter((book) => hasLitresUrls(book)).length;
    console.log(`Found Litres links for ${booksWithLitresUrls} book(s)`);
    console.log(`Skipped ${skippedLitres} book(s) with existing Litres links`);
    console.log(`Enriched ${enrichedLitres} book(s) with new Litres links`);
  }
  if (ranAudiobookDurationEnrichment) {
    const booksWithAudiobookUrls = books.filter((book) => firstAudiobookUrlForBook(book)).length;
    const booksWithAudiobookDuration = books.filter(hasRecordedAudiobookDuration).length;
    console.log(`Found audiobook links for ${booksWithAudiobookUrls} book(s)`);
    console.log(`Found audiobook duration for ${booksWithAudiobookDuration} book(s)`);
    console.log(`Skipped ${skippedAudiobookDuration} book(s) with existing audiobook duration`);
    console.log(`Enriched ${enrichedAudiobookDuration} book(s) with audiobook duration`);
  }
  for (const fetched of fetchedPages) {
    console.log(`- ${fetched.url}: ${fetched.html.length} characters`);
  }
  console.log(`Output path: ${outputPath}`);
  console.log(`Saved ${books.length} book(s) from ${fetchedPages.length} page(s) to ${outputPath}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
