#!/usr/bin/env node

import {
  DEFAULT_MAX_PAGES,
  DEFAULT_PAGE_DELAY_MS,
  DEFAULT_PROFILE_DIR,
  fetchWishlistPagesWithBrowser,
  fetchYandexBooksSearchPageWithBrowser,
} from './lib/browser.mjs';
import { loadBooksJsonIfExists, loadHtmlFile, writeBooksJson } from './lib/json-output.mjs';
import { extractBooksFromPages, parseLivelibWishlistUrl } from './lib/livelib.mjs';
import {
  countBooksWithExistingYandexBooksUrls,
  enrichBooksWithYandexBooksUrls,
} from './lib/yandex-books.mjs';

const DEFAULT_YANDEX_MAX_RESULTS = 5;
const DEFAULT_YANDEX_DELAY_MS = 1500;

function parseArgs(argv) {
  const args = {
    out: 'wishlist.json',
    html: null,
    browser: false,
    withYandexBooks: false,
    maxPages: DEFAULT_MAX_PAGES,
    pageDelayMs: DEFAULT_PAGE_DELAY_MS,
    profileDir: DEFAULT_PROFILE_DIR,
    yandexMaxResults: DEFAULT_YANDEX_MAX_RESULTS,
    yandexDelayMs: DEFAULT_YANDEX_DELAY_MS,
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
    } else if (arg === '--page-delay-ms') {
      args.pageDelayMs = Number.parseInt(argv[++i], 10);
    } else if (arg === '--profile-dir') {
      args.profileDir = argv[++i];
    } else if (arg === '--yandex-max-results') {
      args.yandexMaxResults = Number.parseInt(argv[++i], 10);
    } else if (arg === '--yandex-delay-ms') {
      args.yandexDelayMs = Number.parseInt(argv[++i], 10);
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
  --page-delay-ms <number> Delay between pagination requests. Default: ${DEFAULT_PAGE_DELAY_MS}
  --with-yandex-books      Search matching books on Yandex Books and save yandex_books_urls.
  --yandex-max-results <n> Maximum matching Yandex Books URLs per book. Default: ${DEFAULT_YANDEX_MAX_RESULTS}
  --yandex-delay-ms <n>    Delay between Yandex Books searches. Default: ${DEFAULT_YANDEX_DELAY_MS}
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
  if (!Number.isInteger(args.yandexDelayMs) || args.yandexDelayMs < 0) {
    console.error('error: --yandex-delay-ms must be a non-negative integer');
    return 2;
  }

  let wishlistUrl;
  try {
    wishlistUrl = parseLivelibWishlistUrl(args.url);
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
        pageDelayMs: args.pageDelayMs,
        profileDir: args.profileDir,
      });
    } else {
      throw new Error('Use --browser for the main workflow, or --html for a saved HTML fallback.');
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 2;
  }

  let books = extractBooksFromPages(fetchedPages);
  let skippedYandexBooks = 0;
  if (args.withYandexBooks) {
    const existingBooks = await loadBooksJsonIfExists(args.out);
    skippedYandexBooks = countBooksWithExistingYandexBooksUrls(books, existingBooks);
    books = await enrichBooksWithYandexBooksUrls(books, {
      existingBooks,
      fetchSearchPage: yandexSearchPageFetcher ?? fetchYandexBooksSearchPageWithBrowser,
      profileDir: args.profileDir,
      maxResults: args.yandexMaxResults,
      delayMs: args.yandexDelayMs,
      sleep: yandexSleep,
    });
  }

  const outputPath = await writeBooksJson(args.out, books);

  console.log(`Accepted LiveLib wish-list URL for user ${wishlistUrl.username}: ${wishlistUrl.url}`);
  console.log(`Loaded ${fetchedPages.length} HTML page(s)`);
  console.log(`Found ${books.length} book(s)`);
  if (args.withYandexBooks) {
    const booksWithYandexUrls = books.filter((book) => book.yandex_books_urls.length > 0).length;
    console.log(`Found Yandex Books links for ${booksWithYandexUrls} book(s)`);
    console.log(`Skipped ${skippedYandexBooks} book(s) with existing Yandex Books links`);
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
