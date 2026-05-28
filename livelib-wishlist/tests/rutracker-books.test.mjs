import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRutrackerSearchUrl,
  countBooksWithExistingRutrackerUrls,
  enrichBooksWithRutrackerUrls,
  extractMatchingRutrackerUrls
} from "../scripts/lib/rutracker-books.mjs";

test("builds RuTracker search URL with encoded query", () => {
  const searchUrl = new URL(
    buildRutrackerSearchUrl(" Сто лет одиночества  Маркес ")
  );

  assert.equal(searchUrl.origin, "https://rutracker.org");
  assert.equal(searchUrl.pathname, "/forum/tracker.php");
  assert.equal(searchUrl.searchParams.get("nm"), "Сто лет одиночества Маркес");
});

test("throws for empty RuTracker search query", () => {
  assert.throws(() => buildRutrackerSearchUrl("   "), /must not be empty/u);
});

test("extracts RuTracker links only from title cells", () => {
  const html = `
    <table>
      <tr>
        <td>
          <a href="viewtopic.php?t=100">Сто лет одиночества Маркес kbps</a>
        </td>
      </tr>
      <tr>
        <td class="t-title-col">
          <a href="viewtopic.php?t=200">Сто лет одиночества Маркес kbps</a>
        </td>
      </tr>
    </table>
  `;

  assert.deepEqual(
    extractMatchingRutrackerUrls(html, "Сто лет одиночества Маркес"),
    ["https://rutracker.org/forum/viewtopic.php?t=200"]
  );
});

test("requires all search words in RuTracker result text", () => {
  const html = `
    <table>
      <tr>
        <td class="t-title-col">
          <a href="viewtopic.php?t=100">Сто лет одиночества kbps</a>
        </td>
      </tr>
      <tr>
        <td class="t-title-col">
          <a href="viewtopic.php?t=200">Сто лет одиночества Маркес kbps</a>
        </td>
      </tr>
    </table>
  `;

  assert.deepEqual(
    extractMatchingRutrackerUrls(html, "Сто лет одиночества Маркес"),
    ["https://rutracker.org/forum/viewtopic.php?t=200"]
  );
});

test("requires kbps in RuTracker result text", () => {
  const html = `
    <table>
      <tr>
        <td class="t-title-col">
          <a href="viewtopic.php?t=100">Сто лет одиночества Маркес FB2</a>
        </td>
      </tr>
      <tr>
        <td class="t-title-col">
          <a href="viewtopic.php?t=200">Сто лет одиночества Маркес kbps</a>
        </td>
      </tr>
    </table>
  `;

  assert.deepEqual(
    extractMatchingRutrackerUrls(html, "Сто лет одиночества Маркес"),
    ["https://rutracker.org/forum/viewtopic.php?t=200"]
  );
});

test("deduplicates RuTracker links and respects maxResults", () => {
  const html = `
    <table>
      <tr>
        <td class="t-title-col">
          <a href="/forum/viewtopic.php?t=100">Сто лет одиночества Маркес kbps</a>
        </td>
      </tr>
      <tr>
        <td class="t-title-col">
          <a href="https://rutracker.org/forum/viewtopic.php?t=100">Сто лет одиночества Маркес kbps</a>
        </td>
      </tr>
      <tr>
        <td class="t-title-col">
          <a href="viewtopic.php?t=200">Сто лет одиночества Маркес kbps</a>
        </td>
      </tr>
    </table>
  `;

  assert.deepEqual(
    extractMatchingRutrackerUrls(
      html,
      "Сто лет одиночества Маркес",
      "https://rutracker.org/forum/",
      {
        maxResults: 1
      }
    ),
    ["https://rutracker.org/forum/viewtopic.php?t=100"]
  );
});

test("keeps existing RuTracker URLs and skips repeated search", async () => {
  const books = [
    {
      title: "Сто лет одиночества",
      authors: ["Габриэль Гарсиа Маркес"],
      url: "https://www.livelib.ru/book/100000"
    },
    {
      title: "Полковнику никто не пишет",
      authors: ["Габриэль Гарсиа Маркес"],
      url: "https://www.livelib.ru/book/200000"
    }
  ];
  const existingBooks = [
    {
      ...books[0],
      rutracker_urls: ["https://rutracker.org/forum/viewtopic.php?t=100"]
    }
  ];
  const queries = [];

  const enriched = await enrichBooksWithRutrackerUrls(books, {
    existingBooks,
    async fetchSearchPage({ query }) {
      queries.push(query);
      return {
        url: buildRutrackerSearchUrl(query),
        html: `
          <table>
            <tr>
              <td class="t-title-col">
                <a href="viewtopic.php?t=200">Полковнику никто не пишет Маркес kbps</a>
              </td>
            </tr>
          </table>
        `
      };
    },
    async sleep() {}
  });

  assert.equal(countBooksWithExistingRutrackerUrls(books, existingBooks), 1);
  assert.deepEqual(queries, ["Полковнику никто не пишет"]);
  assert.deepEqual(enriched, [
    {
      ...books[0],
      rutracker_urls: ["https://rutracker.org/forum/viewtopic.php?t=100"]
    },
    {
      ...books[1],
      rutracker_urls: ["https://rutracker.org/forum/viewtopic.php?t=200"]
    }
  ]);
});
