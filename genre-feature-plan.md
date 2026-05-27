# План работ: поле genre для LiveLib

## Цель

Добавить новое поле `genre`, которое дозаполняется вместе с `image` и
`description` из страницы книги LiveLib.

## Правила заполнения

- Если поля `genre` нет в книге, открыть страницу LiveLib и искать жанр в
  элементах `.bc-info__item`.
- Если `genre` уже есть, включая значение `null`, не обновлять его.
- Если на странице найден текст `Научно-популярная литература`, записать
  `"научпоп"`.
- Если найдено `фантастика`, записать `"фантастика"`.
- Если найдено `фэнтези`, записать `"фэнтези"`.
- Если ничего из списка не найдено, вернуть `null` из парсера, но не добавлять
  поле в книгу при enrichment.

## Изменения в коде

1. Обновить `livelib-wishlist/scripts/lib/livelib.mjs`.
   - Расширить `extractBookPageDetails()` до `{ description, image, genre }`.
   - Добавить парсер жанра из `.bc-info__item`.
   - Добавить нормализацию жанра по правилам выше.
   - Добавить `hasRecordedBookPageGenre(book)`.
   - Обновить `needsBookPageDetails(book)`, чтобы страница книги нужна была,
     если нет `description`, нет `image` или поле `genre` отсутствует.
   - Обновить `enrichBooksWithBookPageDetails()`, чтобы он дозаполнял только
     отсутствующий `genre` и не записывал `null`.

2. Обновить `livelib-wishlist/scripts/lib/book-details-enrichment.mjs`.
   - Добавить `hasGenre` в состояние недостающих деталей.
   - Добавить статистику `enrichedBookGenres`.
   - При получении деталей записывать `genre` только если поле отсутствовало и
     `details.genre !== null`.
   - Экспортировать `hasRecordedBookPageGenre`.

3. Обновить `livelib-wishlist/scripts/livelib-wish-to-json.mjs`.
   - Забрать новую статистику enrichment.
   - Добавить подсчет книг с записанным `genre`.
   - Добавить CLI-логи:
     - `Found LiveLib genres for N book(s)`;
     - `Enriched N book(s) with LiveLib genres`.

4. Обновить `livelib-wishlist/SKILL.md`.
   - Добавить `genre` в JSON-схему результата.
   - Уточнить, что существующее поле `genre`, включая `null`, сохраняется и не
     перезаписывается.

## Тесты

Добавить или обновить тесты, но не запускать их автоматически.

1. `livelib-wishlist/tests/livelib.test.mjs`
   - Парсинг `Научно-популярная литература` в `научпоп`.
   - Парсинг `фантастика`.
   - Парсинг `фэнтези`.
   - Возврат `null`, если подходящий жанр не найден.
   - Сохранение существующего `genre`.
   - Сохранение существующего `genre: null` без повторного обновления.

2. `livelib-wishlist/tests/book-details-enrichment.test.mjs`
   - Дозаполнение отсутствующего `genre` вместе с `description` и `image`.
   - Отсутствие записи поля, если парсер вернул `null`.
   - Не перезаписывать существующий `genre`.

3. `livelib-wishlist/tests/cli.test.mjs`
   - Проверить запись `genre` в итоговый JSON.
   - Проверить новые CLI-логи по жанрам.

## Команда для проверки пользователем

```bash
npm test
```
