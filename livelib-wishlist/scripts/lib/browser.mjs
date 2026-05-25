import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractWishlistPageUrls,
  getWishlistPaginationPageNumber,
  isWishlistContentUrl,
  LiveLibAccessError,
} from './livelib.mjs';
import { buildYandexBooksSearchUrl } from './yandex-books.mjs';
import { cleanText } from './text-match.mjs';

export const DEFAULT_MAX_PAGES = 50;
export const DEFAULT_PAGE_DELAY_MS = 1000;

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_PROFILE_DIR = resolve(SKILL_DIR, '.browser-profile');

export function resolveProfileDir(profileDir = DEFAULT_PROFILE_DIR) {
  return resolve(profileDir);
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

export async function fetchYandexBooksSearchPageWithBrowser({
  query,
  profileDir = DEFAULT_PROFILE_DIR,
  playwright,
}) {
  const searchUrl = buildYandexBooksSearchUrl(query);
  const playwrightApi = playwright ?? await import('playwright');
  const context = await playwrightApi.chromium.launchPersistentContext(resolveProfileDir(profileDir), {
    headless: false,
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    return {
      query: cleanText(query),
      url: page.url(),
      html: await page.content(),
    };
  } finally {
    await context.close();
  }
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
