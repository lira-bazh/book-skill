import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractWishlistPageUrls,
  getWishlistPaginationPageNumber,
  isWishlistContentUrl,
  LiveLibAccessError,
} from './livelib.mjs';
import { buildLitresSearchUrl } from './litres-books.mjs';
import { buildYandexBooksSearchUrl } from './yandex-books.mjs';
import { cleanText } from './text-match.mjs';

export const DEFAULT_MAX_PAGES = 50;
export const DEFAULT_PAGE_DELAY_MS = 2000;
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 120000;
export const DEFAULT_NAVIGATION_ATTEMPTS = 3;
export const DEFAULT_LITRES_RESULTS_WAIT_TIMEOUT_MS = 5000;

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

function isRetriableNavigationError(error) {
  const message = error?.message ?? '';
  return message.includes('net::ERR_NETWORK_CHANGED')
    || message.includes('net::ERR_TIMED_OUT')
    || message.includes('net::ERR_HTTP_RESPONSE_CODE_FAILURE')
    || message.includes('Timeout');
}

async function gotoWithRetry(page, url, {
  attempts = DEFAULT_NAVIGATION_ATTEMPTS,
  retryDelayMs = DEFAULT_PAGE_DELAY_MS,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetriableNavigationError(error)) {
        throw error;
      }
      await sleep(retryDelayMs);
    }
  }
  throw lastError;
}

export async function fetchYandexBooksSearchPageWithBrowser({
  query,
  profileDir = DEFAULT_PROFILE_DIR,
  playwright,
}) {
  return withBrowserSession({ profileDir, playwright }, ({ fetchYandexBooksSearchPage }) => (
    fetchYandexBooksSearchPage({ query })
  ));
}

export async function fetchLitresSearchPageWithBrowser({
  query,
  searchUrl,
  profileDir = DEFAULT_PROFILE_DIR,
  playwright,
}) {
  return withBrowserSession({ profileDir, playwright }, ({ fetchLitresSearchPage }) => (
    fetchLitresSearchPage({ query, searchUrl })
  ));
}

async function fetchYandexBooksSearchPageWithPage(page, { query }) {
  const searchUrl = buildYandexBooksSearchUrl(query);
  await gotoWithRetry(page, searchUrl);
  return {
    query: cleanText(query),
    url: page.url(),
    html: await page.content(),
  };
}

async function fetchLitresSearchPageWithPage(page, { query, searchUrl }) {
  const normalizedQuery = cleanText(query);
  const targetUrl = searchUrl ?? buildLitresSearchUrl(normalizedQuery);

  await gotoWithRetry(page, targetUrl);
  await waitForLitresSearchResults(page);
  return {
    query: normalizedQuery,
    url: page.url(),
    html: await page.content(),
  };
}

async function waitForLitresSearchResults(page) {
  if (typeof page.waitForLoadState === 'function') {
    await page.waitForLoadState('networkidle', {
      timeout: DEFAULT_LITRES_RESULTS_WAIT_TIMEOUT_MS,
    }).catch(() => {});
  }

  if (typeof page.waitForFunction !== 'function') {
    return;
  }

  await page.waitForFunction(() => {
    const itemPathRe = /^\/(?:book|audiobook)\/[^/]+(?:\/[^/]+)*\/?$/;
    return [...document.querySelectorAll('a[href]')].some((element) => {
      try {
        const url = new URL(element.getAttribute('href'), window.location.href);
        const hostname = url.hostname.toLowerCase();
        return (hostname === 'www.litres.ru' || hostname === 'litres.ru')
          && itemPathRe.test(url.pathname);
      } catch {
        return false;
      }
    });
  }, undefined, {
    timeout: DEFAULT_LITRES_RESULTS_WAIT_TIMEOUT_MS,
  }).catch(() => {});
}

export async function withLitresSearchBrowserSession({
  profileDir = DEFAULT_PROFILE_DIR,
  playwright,
  onBeforeSearch,
} = {}, callback) {
  if (typeof callback !== 'function') {
    throw new Error('Litres browser session callback is required');
  }

  return withBrowserSession({ profileDir, playwright }, async (session) => {
    await session.openLitresHome();
    if (typeof onBeforeSearch === 'function') {
      await onBeforeSearch({
        pageUrl: session.page.url(),
      });
    }

    return callback({
      fetchSearchPage: session.fetchLitresSearchPage,
    });
  });
}

async function fetchWishlistPagesWithPage(page, {
  wishlistUrl,
  maxPages = DEFAULT_MAX_PAGES,
  pageDelayMs = 0,
}) {
  if (maxPages < 1) {
    throw new Error('maxPages must be greater than zero');
  }

  const pending = [wishlistUrl.url];
  const queued = new Set(pending);
  const queuedPageNumbers = new Set();
  const fetchedPages = [];

  while (pending.length > 0 && fetchedPages.length < maxPages) {
    const url = pending.shift();
    await gotoWithRetry(page, url);

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
}

export async function withBrowserSession({
  profileDir = DEFAULT_PROFILE_DIR,
  playwright,
} = {}, callback) {
  if (typeof callback !== 'function') {
    throw new Error('Browser session callback is required');
  }

  const playwrightApi = playwright ?? await import('playwright');
  const context = await playwrightApi.chromium.launchPersistentContext(resolveProfileDir(profileDir), {
    headless: false,
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    return await callback({
      page,
      fetchWishlistPages: (options) => fetchWishlistPagesWithPage(page, options),
      fetchYandexBooksSearchPage: (options) => fetchYandexBooksSearchPageWithPage(page, options),
      fetchLitresSearchPage: (options) => fetchLitresSearchPageWithPage(page, options),
      openLitresHome: async () => {
        await gotoWithRetry(page, 'https://www.litres.ru/');
        return {
          url: page.url(),
          html: await page.content(),
        };
      },
    });
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
  return withBrowserSession({ profileDir, playwright }, ({ fetchWishlistPages }) => (
    fetchWishlistPages({ wishlistUrl, maxPages, pageDelayMs })
  ));
}
