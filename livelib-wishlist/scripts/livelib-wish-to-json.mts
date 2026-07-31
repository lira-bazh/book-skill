#!/usr/bin/env node

import { createInterface } from "node:readline/promises";

import { enrichBooksWithMissingDetails } from "./books/book-details-enrichment.mjs";
import {
  audiobookEntriesForBook,
  isRutrackerUrl
} from "./books/book-url-fields.mjs";
import {
  DEFAULT_MAX_PAGES,
  type BrowserSession,
  fetchYandexBooksSearchPageWithBrowser,
  withBrowserSession,
  withLitresSearchBrowserSession
} from "./browser/browser.mjs";
import {
  booksJsonExists,
  loadBooksJsonIfExists,
  loadHtmlFile,
  writeBooksJson
} from "./output/json-output.mjs";
import {
  extractBooksFromPages,
  type LiveLibBook,
  matchBooksByLiveLibUrl,
  mergeExistingLiveLibBooks,
  parseLivelibWishlistUrl
} from "./livelib/livelib.mjs";
import {
  countBooksWithExistingLitresUrls,
  enrichBooksWithLitresUrls
} from "./audiobook-sources/litres-books.mjs";
import {
  countBooksWithExistingRutrackerUrls,
  enrichBooksWithRutrackerUrls,
  fetchRutrackerSearchPage
} from "./audiobook-sources/rutracker-books.mjs";
import {
  countBooksWithExistingYandexBooksUrls,
  enrichBooksWithYandexBooksUrls
} from "./audiobook-sources/yandex-books.mjs";

const DEFAULT_MAX_RESULTS = 5;
const FIXED_REQUEST_DELAY_MS = 3000;
const RUTRACKER_REQUEST_DELAY_MS = 10000;

type AppBook = Record<string | symbol, unknown> & {
  url?: string;
  title?: unknown;
  authors?: unknown;
  yandex_books_urls?: unknown;
  litres_urls?: unknown;
  audiobooks_urls?: unknown;
  audiobook_duration_minutes?: unknown;
};

type HtmlPage = {
  url: string;
  html: string;
};

type CliArgs = {
  out: string;
  html: string | null;
  maxPages: number;
  profileDir?: string;
  maxResults: number;
  help?: boolean;
  url?: string;
};

type ParsedCliArgs =
  | { ok: true; args: CliArgs }
  | { ok: false; error: string };

type SearchPage = {
  query?: string;
  url: string;
  html: string;
};

type SearchPageFetcher = (options: {
  query: string;
  searchUrl?: string;
  book?: AppBook;
  profileDir?: unknown;
  playwright?: unknown;
}) => Promise<SearchPage> | SearchPage;

type PageFetcher = (options: {
  url: string;
  book: Record<string, unknown> & { url?: string | null };
}) => Promise<HtmlPage> | HtmlPage;

type SleepFn = (ms: number) => Promise<unknown>;

type LoginConfirmationOptions = {
  pageUrl?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

type MainDependencies = {
  yandexSearchPageFetcher?: SearchPageFetcher;
  yandexSleep?: SleepFn;
  litresSearchPageFetcher?: SearchPageFetcher;
  litresSleep?: SleepFn;
  rutrackerSearchPageFetcher?: SearchPageFetcher;
  rutrackerSleep?: SleepFn;
  audiobookPageFetcher?: PageFetcher;
  audiobookSleep?: SleepFn;
  bookPageFetcher?: PageFetcher;
  bookPageSleep?: SleepFn;
  confirmLitresLogin?: (options?: LoginConfirmationOptions) => Promise<void> | void;
  confirmRutrackerLogin?: (options?: LoginConfirmationOptions) => Promise<void> | void;
  browserSessionRunner?: (
    options: { profileDir?: string },
    callback: (browserSession: BrowserSession) => Promise<void> | void
  ) => Promise<void>;
  withLitresSearchSession?: (
    options: {
      profileDir?: string;
      onBeforeSearch?: (options: LoginConfirmationOptions) => Promise<void> | void;
    },
    callback: (session: { fetchSearchPage: SearchPageFetcher }) => Promise<void> | void
  ) => Promise<void>;
  booksJsonExistsFn?: typeof booksJsonExists;
  loadBooksJsonIfExistsFn?: (path: string) => Promise<AppBook[]>;
  writeBooksJsonFn?: (path: string, books: readonly AppBook[]) => Promise<string>;
};

type YandexEnrichOptions = NonNullable<
  Parameters<typeof enrichBooksWithYandexBooksUrls>[1]
>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bookTitle(book: unknown): string {
  if (typeof book !== "object" || book === null || !("title" in book)) {
    return "";
  }

  const title = (book as { title?: unknown }).title;
  return typeof title === "string" ? title : "";
}

function hasYandexBooksUrls(book: AppBook): boolean {
  return (
    Array.isArray(book?.yandex_books_urls) && book.yandex_books_urls.length > 0
  );
}

function hasLitresUrls(book: AppBook): boolean {
  return Array.isArray(book?.litres_urls) && book.litres_urls.length > 0;
}

function hasRutrackerUrls(book: AppBook): boolean {
  return (
    Array.isArray(book?.audiobooks_urls) &&
    book.audiobooks_urls.some((url) => isRutrackerUrl(url))
  );
}

function countAudiobookLinksWithDuration(books: readonly AppBook[]): number {
  return books.reduce(
    (count, book) =>
      count +
      audiobookEntriesForBook(book).filter((entry) =>
        Number.isFinite(entry.duration)
      ).length,
    0
  );
}

function hasAverageAudiobookDuration(book: AppBook): boolean {
  return Number.isFinite(book?.audiobook_duration_minutes);
}

function parseArgs(argv: readonly string[]): ParsedCliArgs {
  const args: CliArgs = {
    out: "wishlist.json",
    html: null,
    maxPages: DEFAULT_MAX_PAGES,
    profileDir: undefined,
    maxResults: DEFAULT_MAX_RESULTS
  };
  const positional: string[] = [];

  const nextFlagValue = (index: number): string | null => {
    const value = argv[index + 1];
    return value && !value.startsWith("-") ? value : null;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--out") {
      const value = nextFlagValue(i);
      if (!value) {
        return { ok: false, error: "--out requires a value" };
      }
      args.out = value;
      i += 1;
    } else if (arg === "--html") {
      const value = nextFlagValue(i);
      if (!value) {
        return { ok: false, error: "--html requires a value" };
      }
      args.html = value;
      i += 1;
    } else if (arg === "--max-pages") {
      const value = nextFlagValue(i);
      if (!value) {
        return { ok: false, error: "--max-pages requires a value" };
      }
      args.maxPages = Number(value);
      i += 1;
    } else if (arg === "--profile-dir") {
      const value = nextFlagValue(i);
      if (!value) {
        return { ok: false, error: "--profile-dir requires a value" };
      }
      args.profileDir = value;
      i += 1;
    } else if (arg === "--max-results" || arg === "--yandex-max-results") {
      const value = nextFlagValue(i);
      if (!value) {
        return { ok: false, error: `${arg} requires a value` };
      }
      args.maxResults = Number(value);
      i += 1;
    } else if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg.startsWith("-")) {
      return { ok: false, error: `unknown option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }

  args.url = positional[0];
  return { ok: true, args };
}

function printHelp() {
  const scriptPath = process.argv[1]?.endsWith("livelib-wish-to-json.mjs")
    ? process.argv[1]
    : "livelib-wishlist/scripts/livelib-wish-to-json.mjs";

  console.log(`Usage:
  node ${scriptPath} <url> --out wishlist.json --max-pages 50
  node ${scriptPath} <url> --html wish_page.html --out wishlist.json

Options:
  --profile-dir <path>     Persistent browser profile directory. Default: livelib-wishlist/.browser-profile
  --html <path>            Fallback: load a saved HTML file.
  --out <path>             Output JSON path. Default: wishlist.json
  --max-pages <number>     Maximum pagination pages. Default: ${DEFAULT_MAX_PAGES}
  Request delay is fixed at ${FIXED_REQUEST_DELAY_MS} ms for LiveLib pagination, Yandex Books searches, and Litres searches.
  RuTracker request delay is fixed at ${RUTRACKER_REQUEST_DELAY_MS} ms.
  Browser workflow searches matching books on Yandex Books, Litres, and RuTracker automatically.
  --max-results <n>       Maximum matching URLs per book for each search enrichment. Default: ${DEFAULT_MAX_RESULTS}
`);
}

async function waitForLitresLoginConfirmation({
  input = process.stdin,
  output = process.stdout
}: LoginConfirmationOptions = {}) {
  const readline = createInterface({ input, output });
  try {
    await readline.question(
      "Litres is open in the browser. Sign in manually if needed, then press Enter here to continue..."
    );
  } finally {
    readline.close();
  }
}

async function waitForRutrackerLoginConfirmation({
  input = process.stdin,
  output = process.stdout
}: LoginConfirmationOptions = {}) {
  const readline = createInterface({ input, output });
  try {
    await readline.question(
      "RuTracker is open in the browser. Sign in manually if needed, then press Enter here to continue..."
    );
  } finally {
    readline.close();
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  {
    yandexSearchPageFetcher,
    yandexSleep,
    litresSearchPageFetcher,
    litresSleep,
    rutrackerSearchPageFetcher,
    rutrackerSleep,
    audiobookPageFetcher,
    audiobookSleep,
    bookPageFetcher,
    bookPageSleep,
    confirmLitresLogin = waitForLitresLoginConfirmation,
    confirmRutrackerLogin = waitForRutrackerLoginConfirmation,
    browserSessionRunner = withBrowserSession,
    withLitresSearchSession = withLitresSearchBrowserSession,
    booksJsonExistsFn = booksJsonExists,
    loadBooksJsonIfExistsFn = loadBooksJsonIfExists,
    writeBooksJsonFn = writeBooksJson
  }: MainDependencies = {}
): Promise<number> {
  const parsedArgs = parseArgs(argv);
  if (!parsedArgs.ok) {
    console.error(`error: ${parsedArgs.error}`);
    return 2;
  }

  const { args } = parsedArgs;

  if (args.help || !args.url) {
    printHelp();
    return args.help ? 0 : 2;
  }

  if (!Number.isInteger(args.maxPages) || args.maxPages < 1) {
    console.error("error: --max-pages must be a positive integer");
    return 2;
  }

  if (!Number.isInteger(args.maxResults) || args.maxResults < 1) {
    console.error("error: --max-results must be a positive integer");
    return 2;
  }
  let wishlistUrl;
  try {
    wishlistUrl = parseLivelibWishlistUrl(args.url);
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    return 2;
  }

  let outputJsonExists: boolean;
  let existingBooks: AppBook[] = [];
  try {
    outputJsonExists = await booksJsonExistsFn(args.out);
    if (outputJsonExists) {
      existingBooks = await loadBooksJsonIfExistsFn(args.out);
    }
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    return 2;
  }

  let fetchedPages: HtmlPage[] = [];
  let livelibBooks: LiveLibBook[] = [];
  let livelibMatch: ReturnType<typeof matchBooksByLiveLibUrl> = {
    matched: [],
    newBooks: [],
    removedBooks: []
  };
  let books: AppBook[] = [];
  let skippedYandexBooks = 0;
  let enrichedYandexBooks = 0;
  let skippedLitres = 0;
  let enrichedLitres = 0;
  let skippedRutracker = 0;
  let enrichedRutracker = 0;
  let ranAudiobookDurationEnrichment = false;
  let skippedAudiobookDuration = 0;
  let enrichedAudiobookDuration = 0;
  let skippedAudiobookNarrator = 0;
  let enrichedAudiobookNarrator = 0;
  let ranBookPageDetailsEnrichment = false;
  let skippedBookPageDetails = 0;
  let enrichedBookDescriptions = 0;
  let enrichedBookImages = 0;
  let enrichedBookGenres = 0;
  let outputPath = "";

  const finishWorkflow = async ({
    nextFetchedPages,
    browserSession = null
  }: {
    nextFetchedPages: HtmlPage[];
    browserSession?: BrowserSession | null;
  }): Promise<void> => {
    fetchedPages = nextFetchedPages;
    livelibBooks = extractBooksFromPages(fetchedPages);
    livelibMatch = matchBooksByLiveLibUrl(livelibBooks, existingBooks);
    books = mergeExistingLiveLibBooks(livelibBooks, existingBooks);
    const shouldEnrichYandexBooks =
      Boolean(browserSession) || typeof yandexSearchPageFetcher === "function";
    const shouldEnrichLitres =
      Boolean(browserSession) || typeof litresSearchPageFetcher === "function";
    const fetchAudiobookPage =
      audiobookPageFetcher ?? browserSession?.fetchAudiobookPage;
    const shouldEnrichAudiobookDuration =
      typeof fetchAudiobookPage === "function";
    const fetchBookPage = bookPageFetcher ?? browserSession?.fetchBookPage;
    const shouldEnrichBookPageDetails = typeof fetchBookPage === "function";

    if (shouldEnrichYandexBooks) {
      const yandexUrlsBeforeEnrichment = new Map(
        books.map((book) => [book.url, hasYandexBooksUrls(book)])
      );
      skippedYandexBooks = countBooksWithExistingYandexBooksUrls(books, books);
      books = await enrichBooksWithYandexBooksUrls(books, {
        existingBooks: books,
        fetchSearchPage: (
          yandexSearchPageFetcher ??
          browserSession?.fetchYandexBooksSearchPage ??
          fetchYandexBooksSearchPageWithBrowser
        ) as YandexEnrichOptions["fetchSearchPage"],
        profileDir: args.profileDir,
        maxResults: args.maxResults,
        delayMs: FIXED_REQUEST_DELAY_MS,
        onSearchError({ book, error }) {
          console.error(
            `warning: skipped Yandex Books search for "${bookTitle(book)}": ${errorMessage(error)}`
          );
        },
        sleep: yandexSleep
      });
      enrichedYandexBooks = books.filter(
        (book) =>
          !yandexUrlsBeforeEnrichment.get(book.url) && hasYandexBooksUrls(book)
      ).length;
    }

    if (shouldEnrichLitres) {
      const litresUrlsBeforeEnrichment = new Map(
        books.map((book) => [book.url, hasLitresUrls(book)])
      );
      skippedLitres = countBooksWithExistingLitresUrls(books, books);

      const enrichWithLitres = async (fetchSearchPage: SearchPageFetcher): Promise<void> => {
        books = await enrichBooksWithLitresUrls(books, {
          existingBooks: books,
          fetchSearchPage,
          profileDir: args.profileDir,
          maxResults: args.maxResults,
          delayMs: FIXED_REQUEST_DELAY_MS,
          onSearchError({ book, error }) {
            console.error(
              `warning: skipped Litres search for "${bookTitle(book)}": ${errorMessage(error)}`
            );
          },
          sleep: litresSleep
        });
      };

      if (litresSearchPageFetcher) {
        await enrichWithLitres(litresSearchPageFetcher);
      } else if (browserSession) {
        const litresHomePage = await browserSession.openLitresHome();
        if (!litresHomePage?.isAuthenticated) {
          await confirmLitresLogin({
            pageUrl: browserSession.page?.url()
          });
        }
        await enrichWithLitres(browserSession.fetchLitresSearchPage);
      } else {
        await withLitresSearchSession(
          {
            profileDir: args.profileDir,
            onBeforeSearch: confirmLitresLogin
          },
          async ({ fetchSearchPage }) => {
            await enrichWithLitres(fetchSearchPage);
          }
        );
      }

      enrichedLitres = books.filter(
        (book) =>
          !litresUrlsBeforeEnrichment.get(book.url) && hasLitresUrls(book)
      ).length;
    }

    const rutrackerUrlsBeforeEnrichment = new Map(
      books.map((book) => [book.url, hasRutrackerUrls(book)])
    );
    skippedRutracker = countBooksWithExistingRutrackerUrls(books, books);

    const enrichWithRutracker = async (fetchSearchPage: SearchPageFetcher): Promise<void> => {
      books = await enrichBooksWithRutrackerUrls(books, {
        existingBooks: books,
        fetchSearchPage,
        profileDir: args.profileDir,
        maxResults: args.maxResults,
        delayMs: RUTRACKER_REQUEST_DELAY_MS,
        onSearchError({ book, error }) {
          console.error(
            `warning: skipped RuTracker search for "${bookTitle(book)}": ${errorMessage(error)}`
          );
        },
        sleep: rutrackerSleep
      });
    };

    if (rutrackerSearchPageFetcher) {
      await enrichWithRutracker(rutrackerSearchPageFetcher);
    } else if (browserSession) {
      let rutrackerHomePage = null;
      try {
        rutrackerHomePage = await browserSession.openRutrackerHome();
      } catch (error) {
        console.error(
          `warning: skipped RuTracker enrichment: ${errorMessage(error)}`
        );
      }

      if (rutrackerHomePage) {
        if (!rutrackerHomePage.isAuthenticated) {
          await confirmRutrackerLogin({
            pageUrl: browserSession.page?.url()
          });
        }
        await enrichWithRutracker(browserSession.fetchRutrackerSearchPage);
      }
    } else {
      await enrichWithRutracker(fetchRutrackerSearchPage);
    }

    enrichedRutracker = books.filter(
      (book) =>
        !rutrackerUrlsBeforeEnrichment.get(book.url) && hasRutrackerUrls(book)
    ).length;

    if (shouldEnrichAudiobookDuration || shouldEnrichBookPageDetails) {
      ranAudiobookDurationEnrichment = shouldEnrichAudiobookDuration;
      ranBookPageDetailsEnrichment = shouldEnrichBookPageDetails;
      const detailsResult = await enrichBooksWithMissingDetails(books, {
        fetchAudiobookPage: shouldEnrichAudiobookDuration
          ? fetchAudiobookPage
          : undefined,
        fetchBookPage: shouldEnrichBookPageDetails ? fetchBookPage : undefined,
        onAudiobookFetchError({ book, error }) {
          console.error(
            `warning: skipped audiobook duration for "${bookTitle(book)}": ${errorMessage(error)}`
          );
        },
        onBookPageFetchError({ book, error }) {
          console.error(
            `warning: skipped LiveLib book page details for "${bookTitle(book)}": ${errorMessage(error)}`
          );
        },
        onBookProcessed({ book }) {
          console.log(`Processed book: ${bookTitle(book)}`);
        },
        pageDelayMs: FIXED_REQUEST_DELAY_MS,
        sleep: {
          audiobook: audiobookSleep,
          bookPage: bookPageSleep
        }
      });
      books = detailsResult.books as AppBook[];
      skippedAudiobookDuration = detailsResult.stats.skippedAudiobookDuration;
      enrichedAudiobookDuration = detailsResult.stats.enrichedAudiobookDuration;
      skippedAudiobookNarrator = detailsResult.stats.skippedAudiobookNarrator;
      enrichedAudiobookNarrator = detailsResult.stats.enrichedAudiobookNarrator;
      skippedBookPageDetails = detailsResult.stats.skippedBookPageDetails;
      enrichedBookDescriptions = detailsResult.stats.enrichedBookDescriptions;
      enrichedBookImages = detailsResult.stats.enrichedBookImages;
      enrichedBookGenres = detailsResult.stats.enrichedBookGenres;
    }

    outputPath = await writeBooksJsonFn(args.out, books);
  };

  try {
    if (args.html) {
      const savedPage = await loadHtmlFile(args.html);
      await finishWorkflow({
        nextFetchedPages: [{ url: wishlistUrl.url, html: savedPage.html }]
      });
    } else {
      await browserSessionRunner(
        { profileDir: args.profileDir },
        async (browserSession) => {
          const nextFetchedPages = await browserSession.fetchWishlistPages({
            wishlistUrl,
            maxPages: args.maxPages,
            pageDelayMs: FIXED_REQUEST_DELAY_MS
          });
          await finishWorkflow({ nextFetchedPages, browserSession });
        }
      );
    }
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    return 2;
  }
  const shouldEnrichYandexBooks =
    !args.html || typeof yandexSearchPageFetcher === "function";
  const shouldEnrichLitres =
    !args.html || typeof litresSearchPageFetcher === "function";

  console.log(
    `Accepted LiveLib wish-list URL for user ${wishlistUrl.username}: ${wishlistUrl.url}`
  );
  console.log(`Loaded ${fetchedPages.length} HTML page(s)`);
  console.log(`Found ${books.length} book(s)`);
  console.log(
    `Loaded ${existingBooks.length} existing book(s) from output JSON`
  );
  console.log(`Found ${livelibBooks.length} book(s) on LiveLib`);
  console.log(`Added ${livelibMatch.newBooks.length} new LiveLib book(s)`);
  if (shouldEnrichYandexBooks) {
    const booksWithYandexUrls = books.filter((book) =>
      hasYandexBooksUrls(book)
    ).length;
    console.log(`Found Yandex Books links for ${booksWithYandexUrls} book(s)`);
    console.log(
      `Skipped ${skippedYandexBooks} book(s) with existing Yandex Books links`
    );
    console.log(
      `Enriched ${enrichedYandexBooks} book(s) with new Yandex Books links`
    );
  }
  if (shouldEnrichLitres) {
    const booksWithLitresUrls = books.filter((book) =>
      hasLitresUrls(book)
    ).length;
    console.log(`Found Litres links for ${booksWithLitresUrls} book(s)`);
    console.log(`Skipped ${skippedLitres} book(s) with existing Litres links`);
    console.log(`Enriched ${enrichedLitres} book(s) with new Litres links`);
  }
  const booksWithRutrackerUrls = books.filter((book) =>
    hasRutrackerUrls(book)
  ).length;
  console.log(`Found RuTracker links for ${booksWithRutrackerUrls} book(s)`);
  console.log(
    `Skipped ${skippedRutracker} book(s) with existing RuTracker links`
  );
  console.log(
    `Enriched ${enrichedRutracker} book(s) with new RuTracker links`
  );
  if (ranAudiobookDurationEnrichment) {
    const booksWithAudiobookUrls = books.filter(
      (book) =>
        Array.isArray(book?.audiobooks_urls) && book.audiobooks_urls.length > 0
    ).length;
    const audiobookLinksWithDuration = countAudiobookLinksWithDuration(books);
    const booksWithAverageAudiobookDuration = books.filter(
      hasAverageAudiobookDuration
    ).length;
    console.log(`Found audiobook links for ${booksWithAudiobookUrls} book(s)`);
    console.log(
      `Found average audiobook duration for ${booksWithAverageAudiobookDuration} book(s)`
    );
    console.log(
      `Found audiobook duration for ${audiobookLinksWithDuration} audiobook link(s)`
    );
    console.log(
      `Skipped ${skippedAudiobookDuration} audiobook link(s) with existing duration`
    );
    console.log(
      `Enriched ${enrichedAudiobookDuration} audiobook link(s) with duration`
    );
    console.log(
      `Skipped ${skippedAudiobookNarrator} audiobook link(s) with existing narrator`
    );
    console.log(
      `Enriched ${enrichedAudiobookNarrator} audiobook link(s) with narrator`
    );
  }
  if (ranBookPageDetailsEnrichment) {
    console.log(
      `Skipped ${skippedBookPageDetails} book(s) with existing LiveLib book page details`
    );
    console.log(
      `Enriched ${enrichedBookDescriptions} book(s) with LiveLib descriptions`
    );
    console.log(`Enriched ${enrichedBookImages} book(s) with LiveLib images`);
    console.log(`Enriched ${enrichedBookGenres} book(s) with LiveLib genres`);
  }
  for (const fetched of fetchedPages) {
    console.log(`- ${fetched.url}: ${fetched.html.length} characters`);
  }
  console.log(`Output path: ${outputPath}`);
  console.log(
    `Saved ${books.length} book(s) from ${fetchedPages.length} page(s) to ${outputPath}`
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
