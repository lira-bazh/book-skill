import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRutrackerAudiobookTitle,
  extractRutrackerSearchResults,
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

test("extractRutrackerSearchResults skips English audiobook forum rows", () => {
  const html = `
    <table>
      <tr>
        <td>Аудиокниги на английском языке</td>
        <td class="t-title-col">
          <a href="viewtopic.php?t=2589948">Alfred Bester - The Stars My Destination [MP3, 128 kbps]</a>
        </td>
      </tr>
      <tr>
        <td>Аудиокниги</td>
        <td class="t-title-col">
          <a href="viewtopic.php?t=2589949">Альфред Бестер - Тигр! Тигр! [MP3, 128 kbps]</a>
        </td>
      </tr>
    </table>
  `;

  assert.deepEqual(
    extractRutrackerSearchResults(html).map((result) => result.url),
    ["https://rutracker.org/forum/viewtopic.php?t=2589949"]
  );
});
