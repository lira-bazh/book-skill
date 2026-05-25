#!/usr/bin/env node

import {
  DEFAULT_MAX_PAGES,
  DEFAULT_PROFILE_DIR,
  fetchWishlistPagesWithBrowser,
  fetchYandexBooksSearchPageWithBrowser,
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
  countBooksWithExistingYandexBooksUrls,
  enrichBooksWithYandexBooksUrls,
} from './lib/yandex-books.mjs';

const DEFAULT_YANDEX_MAX_RESULTS = 5;
const FIXED_REQUEST_DELAY_MS = 2000;

function hasYandexBooksUrls(book) {
  return Array.isArray(book?.yandex_books_urls) && book.yandex_books_urls.length > 0;
}

function parseArgs(argv) {
  const args = {
    out: 'wishlist.json',
    html: null,
    browser: false,
    withYandexBooks: false,
    maxPages: DEFAULT_MAX_PAGES,
    profileDir: DEFAULT_PROFILE_DIR,
    yandexMaxResults: DEFAULT_YANDEX_MAX_RESULTS,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--browser') {
      args.browser = true;
    } else if (arg === '--with-yandex-books') {
      args.withYandexBooks = true;
    } else if (arg === '--out') {
      args.out = argv[++i];
    } else if (arg === '--html') {
      args.html = argv[++i];
    } else if (arg === '--max-pages') {
      args.maxPages = Number.parseInt(argv[++i], 10);
    } else if (arg === '--profile-dir') {
      args.profileDir = argv[++i];
    } else if (arg === '--yandex-max-results') {
      args.yandexMaxResults = Number.parseInt(argv[++i], 10);
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
  console.log(`Usage:
  node scripts/livelib-wish-to-json.mjs <url> --browser --out wishlist.json --max-pages 50
  node scripts/livelib-wish-to-json.mjs <url> --html wish_page.html --out wishlist.json

Options:
  --browser                Open LiveLib in visible Playwright Chromium.
  --profile-dir <path>     Persistent browser profile directory. Default: livelib-wishlist/.browser-profile
  --html <path>            Fallback: load a saved HTML file.
  --out <path>             Output JSON path. Default: wishlist.json
  --max-pages <number>     Maximum pagination pages. Default: ${DEFAULT_MAX_PAGES}
  Request delay is fixed at ${FIXED_REQUEST_DELAY_MS} ms for LiveLib pagination and Yandex Books searches.
  --with-yandex-books      Search matching books on Yandex Books and save yandex_books_urls.
  --yandex-max-results <n> Maximum matching Yandex Books URLs per book. Default: ${DEFAULT_YANDEX_MAX_RESULTS}
`);
}

export async function main(argv = process.argv.slice(2), { yandexSearchPageFetcher, yandexSleep } = {}) {
  const args = parseArgs(argv);

  if (args.help || !args.url) {
    printHelp();
    return args.help ? 0 : 2;
  }

  if (!Number.isInteger(args.yandexMaxResults) || args.yandexMaxResults < 1) {
    console.error('error: --yandex-max-results must be a positive integer');
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
    outputJsonExists = await booksJsonExists(args.out);
    if (outputJsonExists) {
      existingBooks = await loadBooksJsonIfExists(args.out);
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 2;
  }

  let fetchedPages;
  try {
    if (args.html) {
      const savedPage = await loadHtmlFile(args.html);
      fetchedPages = [{ url: wishlistUrl.url, html: savedPage.html }];
    } else if (args.browser) {
      fetchedPages = await fetchWishlistPagesWithBrowser({
        wishlistUrl,
        maxPages: args.maxPages,
        pageDelayMs: FIXED_REQUEST_DELAY_MS,
        profileDir: args.profileDir,
      });
    } else {
      throw new Error('Use --browser for the main workflow, or --html for a saved HTML fallback.');
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 2;
  }

  const livelibBooks = extractBooksFromPages(fetchedPages);
  const livelibMatch = matchBooksByLiveLibUrl(livelibBooks, existingBooks);
  let books = mergeExistingLiveLibBooks(livelibBooks, existingBooks);
  let skippedYandexBooks = 0;
  let enrichedYandexBooks = 0;
  let outputPath;
  try {
    if (args.withYandexBooks) {
      const yandexUrlsBeforeEnrichment = new Map(
        books.map((book) => [book.url, hasYandexBooksUrls(book)]),
      );
      skippedYandexBooks = countBooksWithExistingYandexBooksUrls(books, books);
      books = await enrichBooksWithYandexBooksUrls(books, {
        existingBooks: books,
        fetchSearchPage: yandexSearchPageFetcher ?? fetchYandexBooksSearchPageWithBrowser,
        profileDir: args.profileDir,
        maxResults: args.yandexMaxResults,
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

    outputPath = await writeBooksJson(args.out, books);
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 2;
  }

  console.log(`Accepted LiveLib wish-list URL for user ${wishlistUrl.username}: ${wishlistUrl.url}`);
  console.log(`Loaded ${fetchedPages.length} HTML page(s)`);
  console.log(`Found ${books.length} book(s)`);
  console.log(`Loaded ${existingBooks.length} existing book(s) from output JSON`);
  console.log(`Found ${livelibBooks.length} book(s) on LiveLib`);
  console.log(`Added ${livelibMatch.newBooks.length} new LiveLib book(s)`);
  if (args.withYandexBooks) {
    const booksWithYandexUrls = books.filter((book) => hasYandexBooksUrls(book)).length;
    console.log(`Found Yandex Books links for ${booksWithYandexUrls} book(s)`);
    console.log(`Skipped ${skippedYandexBooks} book(s) with existing Yandex Books links`);
    console.log(`Enriched ${enrichedYandexBooks} book(s) with new Yandex Books links`);
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
