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
export const DEFAULT_LIVELIB_NAVIGATION_ATTEMPTS = 5;
export const DEFAULT_LIVELIB_NAVIGATION_RETRY_DELAY_MS = 5000;
export const DEFAULT_LITRES_RESULTS_WAIT_TIMEOUT_MS = 5000;
export const DEFAULT_LIVELIB_ACCESS_CHALLENGE_WAIT_TIMEOUT_MS = 300000;
export const DEFAULT_LIVELIB_CONTENT_WAIT_TIMEOUT_MS = 10000;
export const DEFAULT_RUTRACKER_SECURITY_VERIFICATION_WAIT_TIMEOUT_MS = 300000;
export const DEFAULT_RUTRACKER_CONTENT_WAIT_TIMEOUT_MS = 10000;

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
    || message.includes('net::ERR_ADDRESS_UNREACHABLE')
    || message.includes('net::ERR_TIMED_OUT')
    || message.includes('net::ERR_HTTP_RESPONSE_CODE_FAILURE')
    || message.includes('Timeout');
}

function isClosedBrowserError(error) {
  const message = error?.message ?? '';
  return message.includes('Target page, context or browser has been closed')
    || message.includes('Browser has been closed')
    || message.includes('Target closed');
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
  const response = await gotoWithRetry(page, url);
  await waitForRutrackerSecurityVerification(page);
  return response;
}

async function gotoLiveLibWithRetry(page, url) {
  return gotoWithRetry(page, url, {
    attempts: DEFAULT_LIVELIB_NAVIGATION_ATTEMPTS,
    retryDelayMs: DEFAULT_LIVELIB_NAVIGATION_RETRY_DELAY_MS,
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
          const userWishlistPathRe = /^\/users\/[0-9]+\/books\/want$/;
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

          if (userWishlistPathRe.test(normalizedPath) && parsed.search === '') {
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
    await gotoLiveLibWithRetry(page, targetUrl);
  }
}

async function waitForPageNetworkIdle(page, timeout = DEFAULT_LIVELIB_CONTENT_WAIT_TIMEOUT_MS) {
  if (typeof page.waitForLoadState !== 'function') {
    return;
  }

  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
}

async function waitForRutrackerSecurityVerification(page, {
  timeoutMs = DEFAULT_RUTRACKER_SECURITY_VERIFICATION_WAIT_TIMEOUT_MS,
} = {}) {
  await waitForPageNetworkIdle(page, DEFAULT_RUTRACKER_CONTENT_WAIT_TIMEOUT_MS);

  if (typeof page.waitForFunction !== 'function') {
    return;
  }

  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? document.body?.textContent ?? '';
    const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
    const isSecurityVerificationPage = (
      normalizedText.includes('performing security verification')
      || normalizedText.includes('security service to protect against malicious bots')
      || (normalizedText.includes('verifying') && normalizedText.includes('cloudflare'))
    );

    return document.readyState === 'complete' && !isSecurityVerificationPage;
  }, undefined, {
    timeout: timeoutMs,
  });

  await waitForPageNetworkIdle(page, DEFAULT_RUTRACKER_CONTENT_WAIT_TIMEOUT_MS);
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

  await gotoLiveLibWithRetry(page, normalizedUrl);
  await expandLiveLibBookDescription(page);
  return {
    url: page.url(),
    html: await page.content(),
  };
}

async function expandLiveLibBookDescription(page) {
  const button = page.locator('button[class*="ShortInfo_ShortInfoTruncateButton"]').first();
  if (await button.count().catch(() => 0) === 0) {
    return;
  }

  await button.click({ timeout: 5000 }).catch(() => {});
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
    const topMenuWords = topMenuText.split(/\s+/u).filter(Boolean);
    return !topMenuWords.includes('Регистрация') && !topMenuWords.includes('Вход');
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
    await gotoLiveLibWithRetry(page, url);

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
  const resolvedProfileDir = resolveProfileDir(profileDir);
  let context = null;
  let page = null;
  let session = null;

  const closeContext = async () => {
    await context?.close().catch(() => {});
    context = null;
    page = null;
    if (session) {
      session.page = null;
    }
  };

  const openContext = async () => {
    context = await playwrightApi.chromium.launchPersistentContext(resolvedProfileDir, {
      headless: false,
    });
    page = context.pages().find((contextPage) => !contextPage.isClosed()) ?? await context.newPage();
    if (session) {
      session.page = page;
    }
    return page;
  };

  const isContextConnected = () => {
    const browser = context?.browser?.();
    return !browser || typeof browser.isConnected !== 'function' || browser.isConnected();
  };

  const getPage = async () => {
    if (page && !page.isClosed() && isContextConnected()) {
      return page;
    }

    if (context && isContextConnected()) {
      try {
        page = context.pages().find((contextPage) => !contextPage.isClosed()) ?? await context.newPage();
        if (session) {
          session.page = page;
        }
        return page;
      } catch {
        await closeContext();
      }
    }

    await closeContext();
    return openContext();
  };

  const runWithActivePage = async (action) => {
    try {
      return await action(await getPage());
    } catch (error) {
      if (!isClosedBrowserError(error)) {
        throw error;
      }

      await closeContext();
      return action(await getPage());
    }
  };

  try {
    page = await openContext();
    session = {
      page,
      fetchWishlistPages: async (options) => runWithActivePage((activePage) => (
        fetchWishlistPagesWithPage(activePage, options)
      )),
      fetchYandexBooksSearchPage: async (options) => runWithActivePage((activePage) => (
        fetchYandexBooksSearchPageWithPage(activePage, options)
      )),
      fetchLitresSearchPage: async (options) => runWithActivePage((activePage) => (
        fetchLitresSearchPageWithPage(activePage, options)
      )),
      fetchRutrackerSearchPage: async (options) => runWithActivePage((activePage) => (
        fetchRutrackerSearchPageWithPage(activePage, options)
      )),
      fetchAudiobookPage: async (options) => runWithActivePage((activePage) => (
        fetchAudiobookPageWithPage(activePage, options)
      )),
      fetchBookPage: async (options) => runWithActivePage((activePage) => (
        fetchBookPageWithPage(activePage, options)
      )),
      openLitresHome: async () => runWithActivePage(async (activePage) => {
        await gotoWithRetry(activePage, 'https://www.litres.ru/');
        const isAuthenticated = await isLitresAuthenticated(activePage);
        return {
          url: activePage.url(),
          isAuthenticated,
          html: await activePage.content(),
        };
      }),
      openRutrackerHome: async () => runWithActivePage(async (activePage) => {
        await gotoRutrackerWithRetry(activePage, 'https://rutracker.org/forum/index.php');
        const isAuthenticated = await isRutrackerAuthenticated(activePage);
        return {
          url: activePage.url(),
          isAuthenticated,
          html: await activePage.content(),
        };
      }),
    };
    return await callback(session);
  } finally {
    await closeContext();
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
