#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WISHLIST_PATH_RE = /^\/reader\/([^/]+)\/wish\/?$/;
const DEFAULT_MAX_PAGES = 50;
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
  if (parsed.pathname.replace(/\/$/, '') !== expectedPath) {
    return null;
  }

  return `https://www.livelib.ru${expectedPath}${parsed.search}`;
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
  const seen = new Set();

  for (const href of extractHrefValues(html)) {
    const normalizedUrl = normalizeWishlistPageUrl(href, username, baseUrl);
    if (normalizedUrl && !seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      urls.push(normalizedUrl);
    }
  }

  return urls;
}

export async function loadHtmlFile(path) {
  const html = await readFile(path, 'utf8');
  return { url: path, html };
}

export function resolveProfileDir(profileDir = DEFAULT_PROFILE_DIR) {
  return resolve(profileDir);
}

function isCurrentWishlistPage(currentUrl, wishlistUrl) {
  const expected = new URL(wishlistUrl.url);

  let current;
  try {
    current = new URL(currentUrl);
  } catch {
    return false;
  }

  return (
    current.hostname === expected.hostname &&
    current.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '')
  );
}

function waitForInput(input = process.stdin) {
  return new Promise((resolveInput) => {
    input.once('data', resolveInput);
    if (typeof input.resume === 'function') {
      input.resume();
    }
  });
}

export async function waitForManualAuthorization(
  page,
  wishlistUrl,
  {
    input = process.stdin,
    output = console,
    waitForAuthorizationInput = waitForInput,
  } = {},
) {
  while (true) {
    if (isCurrentWishlistPage(page.url(), wishlistUrl)) {
      return;
    }

    output.log('LiveLib is not on the wish-list page yet.');
    output.log('Complete login or verification in the browser window, then press Enter here.');
    await waitForAuthorizationInput(input);
  }
}

export async function fetchWishlistPagesWithBrowser({
  wishlistUrl,
  maxPages = DEFAULT_MAX_PAGES,
  profileDir = DEFAULT_PROFILE_DIR,
  playwright,
  input,
  output,
  waitForAuthorizationInput,
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
    const fetchedPages = [];

    while (pending.length > 0 && fetchedPages.length < maxPages) {
      const url = pending.shift();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitForManualAuthorization(page, wishlistUrl, {
        input,
        output,
        waitForAuthorizationInput,
      });

      const html = await page.content();
      const finalUrl = page.url();
      fetchedPages.push({ url: finalUrl, html });

      for (const pageUrl of extractWishlistPageUrls(html, wishlistUrl.username, finalUrl)) {
        if (!queued.has(pageUrl)) {
          queued.add(pageUrl);
          pending.push(pageUrl);
        }
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
      fetchedPages = [await loadHtmlFile(args.html)];
    } else if (args.browser) {
      fetchedPages = await fetchWishlistPagesWithBrowser({
        wishlistUrl,
        maxPages: args.maxPages,
        profileDir: args.profileDir,
      });
    } else {
      throw new Error('Use --browser for the main workflow, or --html for a saved HTML fallback.');
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 2;
  }

  console.log(`Accepted LiveLib wish-list URL for user ${wishlistUrl.username}: ${wishlistUrl.url}`);
  console.log(`Loaded ${fetchedPages.length} HTML page(s)`);
  for (const fetched of fetchedPages) {
    console.log(`- ${fetched.url}: ${fetched.html.length} characters`);
  }
  console.log(`Output path: ${args.out}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
