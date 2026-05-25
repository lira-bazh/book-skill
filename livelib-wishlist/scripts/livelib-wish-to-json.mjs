#!/usr/bin/env node

import {
  DEFAULT_MAX_PAGES,
  DEFAULT_PAGE_DELAY_MS,
  DEFAULT_PROFILE_DIR,
  fetchWishlistPagesWithBrowser,
  fetchYandexBooksSearchPageWithBrowser,
} from './lib/browser.mjs';
import { loadHtmlFile, writeBooksJson } from './lib/json-output.mjs';
import { extractBooksFromPages, parseLivelibWishlistUrl } from './lib/livelib.mjs';
import { enrichBooksWithYandexBooksUrls } from './lib/yandex-books.mjs';

function parseArgs(argv) {
  const args = {
    out: 'wishlist.json',
    html: null,
    browser: false,
    withYandexBooks: false,
    maxPages: DEFAULT_MAX_PAGES,
    pageDelayMs: DEFAULT_PAGE_DELAY_MS,
    profileDir: DEFAULT_PROFILE_DIR,
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
`);
}

export async function main(argv = process.argv.slice(2), { yandexSearchPageFetcher } = {}) {
  const args = parseArgs(argv);

  if (args.help || !args.url) {
    printHelp();
    return args.help ? 0 : 2;
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
  if (args.withYandexBooks) {
    books = await enrichBooksWithYandexBooksUrls(books, {
      fetchSearchPage: yandexSearchPageFetcher ?? fetchYandexBooksSearchPageWithBrowser,
      profileDir: args.profileDir,
    });
  }

  const outputPath = await writeBooksJson(args.out, books);

  console.log(`Accepted LiveLib wish-list URL for user ${wishlistUrl.username}: ${wishlistUrl.url}`);
  console.log(`Loaded ${fetchedPages.length} HTML page(s)`);
  console.log(`Found ${books.length} book(s)`);
  if (args.withYandexBooks) {
    const booksWithYandexUrls = books.filter((book) => book.yandex_books_urls.length > 0).length;
    console.log(`Found Yandex Books links for ${booksWithYandexUrls} book(s)`);
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
