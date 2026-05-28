import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractWishlistPageUrls,
  getWishlistPaginationPageNumber,
  isWishlistContentUrl,
  LiveLibAccessError,
  normalizeBookUrl,
} from './livelib.mjs';
import { buildLitresSearchUrl } from './litres-books.mjs';
import { buildRutrackerSearchUrl } from './rutracker-books.mjs';
import { buildYandexBooksSearchUrl } from './yandex-books.mjs';
import { isAudiobookUrl, isRutrackerUrl } from './book-url-fields.mjs';
import { cleanText } from './text-match.mjs';

export const DEFAULT_MAX_PAGES = 50;
export const DEFAULT_PAGE_DELAY_MS = 2000;
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 120000;
export const DEFAULT_NAVIGATION_ATTEMPTS = 3;
export const DEFAULT_LITRES_RESULTS_WAIT_TIMEOUT_MS = 5000;
export const DEFAULT_LIVELIB_ACCESS_CHALLENGE_WAIT_TIMEOUT_MS = 300000;
export const DEFAULT_LIVELIB_CONTENT_WAIT_TIMEOUT_MS = 10000;

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

function responseStatus(response) {
  return typeof response?.status === 'function' ? response.status() : null;
}

function isUnsuccessfulResponse(response) {
  if (!response) {
    return false;
  }
  return typeof response.ok === 'function' ? !response.ok() : false;
}

function createRetriableResponseError(url, status) {
  return new Error(`Navigation to ${url} returned unsuccessful HTTP status ${status}`);
}

function isLiveLibRateLimitCaptchaUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.toLowerCase() === 'www.livelib.ru'
      && parsed.pathname.replace(/\/$/, '') === '/service/ratelimitcaptcha';
  } catch {
    return false;
  }
}

async function gotoWithRetry(page, url, {
  attempts = DEFAULT_NAVIGATION_ATTEMPTS,
  retryDelayMs = DEFAULT_PAGE_DELAY_MS,
  shouldRetryResponse,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
      });
      const status = responseStatus(response);
      if (typeof shouldRetryResponse !== 'function' || !shouldRetryResponse(response)) {
        return response;
      }

      lastError = createRetriableResponseError(url, status);
      if (attempt >= attempts) {
        break;
      }
      await sleep(retryDelayMs);
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

async function gotoRutrackerWithRetry(page, url) {
  return gotoWithRetry(page, url, {
    shouldRetryResponse: isUnsuccessfulResponse,
  });
}

async function waitForLiveLibAccessChallenge(page, {
  wishlistUrl,
  targetUrl,
  timeoutMs = DEFAULT_LIVELIB_ACCESS_CHALLENGE_WAIT_TIMEOUT_MS,
}) {
  if (typeof page.waitForFunction === 'function') {
    await page.waitForFunction(
      ({ baseUrl, username }) => {
        try {
          const parsed = new URL(window.location.href, baseUrl);
          const expectedPath = `/reader/${username}/wish`;
          const normalizedPath = parsed.pathname.replace(/\/$/, '');
          const listViewPagePathRe = new RegExp(
            `^${expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/listview/[^/]+/~([0-9]+)$`,
          );

          if (
            parsed.hostname.toLowerCase() !== 'www.livelib.ru'
            || !['http:', 'https:'].includes(parsed.protocol)
          ) {
            return false;
          }

          if (normalizedPath === expectedPath && parsed.search === '') {
            return true;
          }

          if (normalizedPath === expectedPath) {
            const pageValues = parsed.searchParams.getAll('page');
            const pageNumber = Number.parseInt(pageValues[0], 10);
            return pageValues.length === 1
              && [...parsed.searchParams.keys()].every((name) => name === 'page')
              && String(pageNumber) === pageValues[0]
              && pageNumber >= 2;
          }

          const listViewMatch = normalizedPath.match(listViewPagePathRe);
          if (!listViewMatch || parsed.search) {
            return false;
          }

          const pageValue = listViewMatch[1];
          const pageNumber = Number.parseInt(pageValue, 10);
          return String(pageNumber) === pageValue && pageNumber >= 2;
        } catch {
          return false;
        }
      },
      {
        baseUrl: wishlistUrl.url,
        username: wishlistUrl.username,
      },
      {
        timeout: timeoutMs,
      },
    ).catch(() => {});
  }

  if (!isWishlistContentUrl(page.url(), wishlistUrl.username, wishlistUrl.url)) {
    await gotoWithRetry(page, targetUrl);
  }
}

async function waitForPageNetworkIdle(page, timeout = DEFAULT_LIVELIB_CONTENT_WAIT_TIMEOUT_MS) {
  if (typeof page.waitForLoadState !== 'function') {
    return;
  }

  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
}

async function scrollPageToBottom(page) {
  if (typeof page.evaluate !== 'function') {
    return;
  }

  await page.evaluate(async () => {
    const delay = (ms) => new Promise((resolveDelay) => {
      setTimeout(resolveDelay, ms);
    });
    let previousHeight = 0;

    for (let step = 0; step < 12; step += 1) {
      const currentHeight = document.documentElement.scrollHeight;
      window.scrollTo(0, currentHeight);
      await delay(250);

      if (currentHeight === previousHeight) {
        break;
      }
      previousHeight = currentHeight;
    }
  }).catch(() => {});
}

async function waitForLiveLibWishlistContent(page) {
  await waitForPageNetworkIdle(page);
  await scrollPageToBottom(page);
  await waitForPageNetworkIdle(page, 3000);
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

export async function fetchRutrackerSearchPageWithBrowser({
  query,
  searchUrl,
  profileDir = DEFAULT_PROFILE_DIR,
  playwright,
}) {
  return withBrowserSession({ profileDir, playwright }, ({ fetchRutrackerSearchPage }) => (
    fetchRutrackerSearchPage({ query, searchUrl })
  ));
}

export async function fetchAudiobookPageWithBrowser({
  url,
  profileDir = DEFAULT_PROFILE_DIR,
  playwright,
}) {
  return withBrowserSession({ profileDir, playwright }, ({ fetchAudiobookPage }) => (
    fetchAudiobookPage({ url })
  ));
}

export async function fetchBookPageWithBrowser({
  url,
  profileDir = DEFAULT_PROFILE_DIR,
  playwright,
}) {
  return withBrowserSession({ profileDir, playwright }, ({ fetchBookPage }) => (
    fetchBookPage({ url })
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

async function fetchRutrackerSearchPageWithPage(page, { query, searchUrl }) {
  const normalizedQuery = cleanText(query);
  const targetUrl = searchUrl ?? buildRutrackerSearchUrl(normalizedQuery);

  await gotoRutrackerWithRetry(page, targetUrl);
  return {
    query: normalizedQuery,
    url: page.url(),
    html: await page.content(),
  };
}

async function fetchAudiobookPageWithPage(page, { url }) {
  if (!isAudiobookUrl(url) && !isRutrackerUrl(url)) {
    throw new Error('Audiobook page URL must be an audiobook or RuTracker topic URL');
  }

  await (
    isRutrackerUrl(url)
      ? gotoRutrackerWithRetry(page, url)
      : gotoWithRetry(page, url)
  );
  return {
    url: page.url(),
    html: await page.content(),
  };
}

async function fetchBookPageWithPage(page, { url }) {
  const normalizedUrl = normalizeBookUrl(url, 'https://www.livelib.ru/');
  if (!normalizedUrl) {
    throw new Error('Book page URL must be a LiveLib book or work URL');
  }

  await gotoWithRetry(page, normalizedUrl);
  return {
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

async function isLitresAuthenticated(page) {
  if (typeof page.evaluate !== 'function') {
    return false;
  }

  return Boolean(await page.evaluate(() => {
    const loginTabText = document.querySelector('#tab-login')?.textContent ?? '';
    return !loginTabText.includes('Войти');
  }).catch(() => false));
}

async function isRutrackerAuthenticated(page) {
  if (typeof page.evaluate !== 'function') {
    return false;
  }

  return Boolean(await page.evaluate(() => {
    const topMenuText = document.querySelector('.topmenu')?.textContent ?? '';
    return !topMenuText.includes('Вход');
  }).catch(() => false));
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
    const homePage = await session.openLitresHome();
    if (!homePage.isAuthenticated && typeof onBeforeSearch === 'function') {
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

    let finalUrl = page.url();
    if (isLiveLibRateLimitCaptchaUrl(finalUrl)) {
      await waitForLiveLibAccessChallenge(page, {
        wishlistUrl,
        targetUrl: url,
      });
      finalUrl = page.url();
    }

    if (!isWishlistContentUrl(finalUrl, wishlistUrl.username, wishlistUrl.url)) {
      throw new LiveLibAccessError(`LiveLib opened an unexpected page instead of the wish-list: ${finalUrl}`);
    }

    await waitForLiveLibWishlistContent(page);
    const html = await page.content();
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
      fetchRutrackerSearchPage: (options) => fetchRutrackerSearchPageWithPage(page, options),
      fetchAudiobookPage: (options) => fetchAudiobookPageWithPage(page, options),
      fetchBookPage: (options) => fetchBookPageWithPage(page, options),
      openLitresHome: async () => {
        await gotoWithRetry(page, 'https://www.litres.ru/');
        const isAuthenticated = await isLitresAuthenticated(page);
        return {
          url: page.url(),
          isAuthenticated,
          html: await page.content(),
        };
      },
      openRutrackerHome: async () => {
        await gotoRutrackerWithRetry(page, 'https://rutracker.org/forum/index.php');
        const isAuthenticated = await isRutrackerAuthenticated(page);
        return {
          url: page.url(),
          isAuthenticated,
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
