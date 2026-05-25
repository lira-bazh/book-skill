#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

const WISHLIST_PATH_RE = /^\/reader\/([^/]+)\/wish\/?$/;
const BOOK_ITEM_PATH_RE = /^\/(?:book|work)\/[^/]+$/;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_PAGE_DELAY_MS = 1000;
const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PROFILE_DIR = resolve(SKILL_DIR, '.browser-profile');

export class LiveLibAccessError extends Error {}

export function parseLivelibWishlistUrl(rawUrl) {
  const parsed = new URL(rawUrl);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must use http or https');
  }

  if (parsed.hostname.toLowerCase() !== 'www.livelib.ru') {
    throw new Error('URL host must be www.livelib.ru');
  }

  const match = parsed.pathname.match(WISHLIST_PATH_RE);
  if (!match) {
    throw new Error('URL path must look like /reader/<username>/wish');
  }

  return {
    username: match[1],
    url: `https://www.livelib.ru${parsed.pathname.replace(/\/$/, '')}`,
  };
}

export function normalizeWishlistPageUrl(rawUrl, username, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== 'www.livelib.ru') {
    return null;
  }

  const expectedPath = `/reader/${username}/wish`;
  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  const listViewPrefix = `${expectedPath}/listview/smalllist/~`;

  if (normalizedPath.startsWith(listViewPrefix)) {
    const pageValue = normalizedPath.slice(listViewPrefix.length);
    const pageNumber = Number.parseInt(pageValue, 10);

    if (String(pageNumber) !== pageValue || pageNumber < 2 || parsed.search) {
      return null;
    }

    return `https://www.livelib.ru${listViewPrefix}${pageNumber}`;
  }

  if (normalizedPath !== expectedPath) {
    return null;
  }

  const pageValues = parsed.searchParams.getAll('page');
  const allowedParams = new Set(['page']);
  const hasOnlyPaginationParams = [...parsed.searchParams.keys()]
    .every((name) => allowedParams.has(name));

  if (pageValues.length !== 1 || !hasOnlyPaginationParams) {
    return null;
  }

  const pageNumber = Number.parseInt(pageValues[0], 10);
  if (String(pageNumber) !== pageValues[0] || pageNumber < 2) {
    return null;
  }

  return `https://www.livelib.ru${expectedPath}?page=${pageNumber}`;
}

function getWishlistPaginationPageNumber(rawUrl, username) {
  const parsed = new URL(rawUrl);
  const expectedPath = `/reader/${username}/wish`;
  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  const listViewPrefix = `${expectedPath}/listview/smalllist/~`;

  if (normalizedPath.startsWith(listViewPrefix)) {
    return Number.parseInt(normalizedPath.slice(listViewPrefix.length), 10);
  }

  if (normalizedPath === expectedPath) {
    return Number.parseInt(parsed.searchParams.get('page'), 10);
  }

  return null;
}

export function extractHrefValues(html) {
  const hrefs = [];
  const linkRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;

  while ((match = linkRe.exec(html)) !== null) {
    hrefs.push(match[1] ?? match[2] ?? match[3]);
  }

  return hrefs;
}

export function extractWishlistPageUrls(html, username, baseUrl) {
  const urls = [];
  const seenPageNumbers = new Set();

  for (const href of extractHrefValues(html)) {
    const normalizedUrl = normalizeWishlistPageUrl(href, username, baseUrl);
    if (!normalizedUrl) {
      continue;
    }

    const pageNumber = getWishlistPaginationPageNumber(normalizedUrl, username);
    if (!seenPageNumbers.has(pageNumber)) {
      seenPageNumbers.add(pageNumber);
      urls.push(normalizedUrl);
    }
  }

  return urls;
}

function isWishlistContentUrl(rawUrl, username, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return false;
  }

  const expectedPath = `/reader/${username}/wish`;
  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  if (
    parsed.hostname.toLowerCase() === 'www.livelib.ru' &&
    normalizedPath === expectedPath &&
    parsed.search === ''
  ) {
    return true;
  }

  return normalizeWishlistPageUrl(rawUrl, username, baseUrl) !== null;
}

export function normalizeBookUrl(rawUrl, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== 'www.livelib.ru') {
    return null;
  }

  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  if (!BOOK_ITEM_PATH_RE.test(normalizedPath)) {
    return null;
  }

  return `https://www.livelib.ru${normalizedPath}`;
}

export function extractBookUrls(html, baseUrl) {
  const urls = [];
  const seen = new Set();

  for (const href of extractHrefValues(html)) {
    const normalizedUrl = normalizeBookUrl(href, baseUrl);
    if (normalizedUrl && !seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      urls.push(normalizedUrl);
    }
  }

  return urls;
}

function cleanText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

export function extractBooks(html, baseUrl) {
  const $ = load(html);
  const books = [];
  const seen = new Set();
  let links = $('a.brow-book-name[href]').toArray();

  if (links.length === 0) {
    links = $('a[href]').toArray().filter((element) => {
      const title = cleanText($(element).text());
      return title && normalizeBookUrl($(element).attr('href'), baseUrl);
    });
  }

  for (const element of links) {
    const link = $(element);
    const url = normalizeBookUrl(link.attr('href'), baseUrl);
    if (!url || seen.has(url)) {
      continue;
    }

    const title = cleanText(link.text());
    if (!title) {
      continue;
    }

    const container = link.closest('.brow-book, .book-item, .ll-book, li');
    const scope = container.length > 0 ? container : link.parent();
    const authors = scope.find('a.brow-book-author')
      .toArray()
      .map((author) => cleanText($(author).text()))
      .filter(Boolean)
      .filter((author, index, values) => values.indexOf(author) === index);

    seen.add(url);
    books.push({ title, authors, url });
  }

  return books;
}

export function extractBooksFromPages(pages) {
  const books = [];
  const seen = new Set();

  for (const page of pages) {
    for (const book of extractBooks(page.html, page.url)) {
      if (!seen.has(book.url)) {
        seen.add(book.url);
        books.push(book);
      }
    }
  }

  return books;
}

export function extractBookUrlsFromPages(pages) {
  const urls = [];
  const seen = new Set();

  for (const page of pages) {
    for (const bookUrl of extractBookUrls(page.html, page.url)) {
      if (!seen.has(bookUrl)) {
        seen.add(bookUrl);
        urls.push(bookUrl);
      }
    }
  }

  return urls;
}

export async function loadHtmlFile(path) {
  const html = await readFile(path, 'utf8');
  return { url: path, html };
}

export async function writeBooksJson(path, books) {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(books, null, 2)}\n`, 'utf8');
  return outputPath;
}

export function resolveProfileDir(profileDir = DEFAULT_PROFILE_DIR) {
  return resolve(profileDir);
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

export async function fetchWishlistPagesWithBrowser({
  wishlistUrl,
  maxPages = DEFAULT_MAX_PAGES,
  profileDir = DEFAULT_PROFILE_DIR,
  playwright,
  pageDelayMs = 0,
}) {
  if (maxPages < 1) {
    throw new Error('maxPages must be greater than zero');
  }

  const playwrightApi = playwright ?? await import('playwright');
  const context = await playwrightApi.chromium.launchPersistentContext(resolveProfileDir(profileDir), {
    headless: false,
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    const pending = [wishlistUrl.url];
    const queued = new Set(pending);
    const queuedPageNumbers = new Set();
    const fetchedPages = [];

    while (pending.length > 0 && fetchedPages.length < maxPages) {
      const url = pending.shift();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const html = await page.content();
      const finalUrl = page.url();
      if (!isWishlistContentUrl(finalUrl, wishlistUrl.username, wishlistUrl.url)) {
        throw new LiveLibAccessError(`LiveLib opened an unexpected page instead of the wish-list: ${finalUrl}`);
      }

      fetchedPages.push({ url: finalUrl, html });

      for (const pageUrl of extractWishlistPageUrls(html, wishlistUrl.username, finalUrl)) {
        const pageNumber = getWishlistPaginationPageNumber(pageUrl, wishlistUrl.username);
        if (!queued.has(pageUrl) && !queuedPageNumbers.has(pageNumber)) {
          queued.add(pageUrl);
          queuedPageNumbers.add(pageNumber);
          pending.push(pageUrl);
        }
      }

      if (pending.length > 0 && pageDelayMs > 0) {
        await sleep(pageDelayMs);
      }
    }

    return fetchedPages;
  } finally {
    await context.close();
  }
}

function parseArgs(argv) {
  const args = {
    out: 'wishlist.json',
    html: null,
    browser: false,
    maxPages: DEFAULT_MAX_PAGES,
    pageDelayMs: DEFAULT_PAGE_DELAY_MS,
    profileDir: DEFAULT_PROFILE_DIR,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--browser') {
      args.browser = true;
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
`);
}

export async function main(argv = process.argv.slice(2)) {
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

  const books = extractBooksFromPages(fetchedPages);
  const outputPath = await writeBooksJson(args.out, books);

  console.log(`Accepted LiveLib wish-list URL for user ${wishlistUrl.username}: ${wishlistUrl.url}`);
  console.log(`Loaded ${fetchedPages.length} HTML page(s)`);
  console.log(`Found ${books.length} book(s)`);
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
