import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRutrackerTorApiSearchUrl,
  extractRutrackerAudiobookTitle,
  extractMatchingRutrackerTorApiAudiobookEntries,
  extractRutrackerTorApiSearchResults,
} from "../livelib-wishlist/scripts/lib/rutracker-books.mjs";

test("extractRutrackerAudiobookTitle combines RuTracker author and title labels", () => {
  const html = `
    <div id="topic_main">
      <table>
        <tbody id="post_123">
          <tr>
            <td>
              <div class="post_body">
                <span class="post-b">Автор</span>: Альфред Бестер<br>
                <span class="post-b">Название</span>: Тигр! Тигр!<br>
                <span class="post-b">Исполнитель</span>: Александр Клюквин<br>
                <span class="post-b">Время звучания</span>: 08:00:00
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  assert.equal(
    extractRutrackerAudiobookTitle(html),
    "Альфред Бестер - Тигр! Тигр!"
  );
});

test("buildRutrackerTorApiSearchUrl builds TorAPI RuTracker title search URL", () => {
  assert.equal(
    buildRutrackerTorApiSearchUrl("Альфред Бестер Тигр"),
    "https://torapi.vercel.app/api/search/title/rutracker?query=%D0%90%D0%BB%D1%8C%D1%84%D1%80%D0%B5%D0%B4+%D0%91%D0%B5%D1%81%D1%82%D0%B5%D1%80+%D0%A2%D0%B8%D0%B3%D1%80&category=0&page=all"
  );
});

test("extractRutrackerTorApiSearchResults normalizes TorAPI results", () => {
  const items = [
    {
      Name: "Альфред Бестер - Тигр! Тигр! [Александр Клюквин, MP3, 128 kbps]",
      Url: "https://rutracker.org/forum/viewtopic.php?t=2589949",
      Category: "Аудиокниги"
    },
    {
      Name: "Alfred Bester - Tiger! Tiger! [MP3, 128 kbps]",
      Url: "https://rutracker.org/forum/viewtopic.php?t=2589950",
      Category: "Аудиокниги на английском языке"
    },
    {
      Name: "Duplicate",
      Url: "https://rutracker.org/forum/viewtopic.php?t=2589949",
      Category: "Аудиокниги"
    }
  ];

  assert.deepEqual(extractRutrackerTorApiSearchResults(items), [
    {
      title: "Альфред Бестер - Тигр! Тигр! [Александр Клюквин, MP3, 128 kbps]",
      url: "https://rutracker.org/forum/viewtopic.php?t=2589949",
      narrator: "Александр Клюквин"
    }
  ]);
});

test("extractMatchingRutrackerTorApiAudiobookEntries requires author last name", () => {
  const items = [
    {
      Name: "Иван Иванов - Тигр! Тигр! [MP3, 128 kbps]",
      Url: "https://rutracker.org/forum/viewtopic.php?t=2589951",
      Category: "Аудиокниги"
    },
    {
      Name: "Альфред Бестер - Тигр! Тигр! [MP3, 128 kbps]",
      Url: "https://rutracker.org/forum/viewtopic.php?t=2589949",
      Category: "Аудиокниги"
    }
  ];

  assert.deepEqual(
    extractMatchingRutrackerTorApiAudiobookEntries(
      items,
      {
        title: "Тигр! Тигр!",
        authors: ["Альфред Бестер"]
      }
    ),
    [
      {
        url: "https://rutracker.org/forum/viewtopic.php?t=2589949",
        narrator: null
      }
    ]
  );
});
