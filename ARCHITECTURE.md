# Архитектура проекта

## Назначение

Проект содержит Codex skill `livelib-wishlist`, который выгружает публичный
wish-list пользователя LiveLib в JSON и обогащает книги ссылками и метаданными
из внешних источников.

Основной сценарий:

1. Принять URL вида `https://www.livelib.ru/reader/<username>/wish`.
2. Загрузить страницы wish-list через видимый браузер Playwright или из
   сохраненного HTML-файла.
3. Извлечь книги LiveLib.
4. Слить результат с существующим JSON, сохранив пользовательские поля.
5. Найти совпадающие ссылки в Yandex Books, Litres и RuTracker.
6. Дозаполнить описание, обложку, жанр, длительность аудиокниг и чтеца.
7. Записать итоговый JSON.

## Структура

```text
.
├── package.json
└── livelib-wishlist
    ├── SKILL.md
    └── scripts
        ├── livelib-wish-to-json.mts
        └── lib
            ├── *.mts
            ├── audiobook-duration.mjs
            ├── audiobook-page-fields.mjs
            ├── book-details-enrichment.mjs
            ├── book-search-match.mjs
            ├── book-search-query.mjs
            ├── book-url-fields.mjs
            ├── browser.mjs
            ├── json-output.mjs
            ├── litres-books.mjs
            ├── livelib.mjs
            ├── rutracker-books.mjs
            ├── text-match.mjs
            └── yandex-books.mjs
```

`SKILL.md` описывает пользовательский workflow и ограничения skill. Исходный
вход находится в `scripts/livelib-wish-to-json.mts`, а исполняемый runtime-код
собирается TypeScript в `livelib-wishlist/dist`.

## Слои

### CLI-оркестрация

`livelib-wish-to-json.mts` отвечает за:

- разбор аргументов CLI;
- валидацию LiveLib URL;
- загрузку существующего JSON;
- запуск браузерного или HTML fallback workflow;
- последовательное обогащение данных;
- вывод статистики и запись результата.

Файл принимает зависимости через параметры `main()`. Это позволяет тестировать
workflow без реального браузера и сети.

### Доступ к страницам

`browser.mjs` инкапсулирует Playwright:

- запускает persistent Chromium profile;
- открывает LiveLib, Yandex Books и Litres;
- повторяет навигацию при временных сетевых ошибках;
- обрабатывает ожидания контента и pagination LiveLib;
- проверяет, что LiveLib не увел браузер за пределы разрешенного wish-list.

Для некоторых страниц деталей `book-details-enrichment.mjs` сначала пробует
`curl`, а при ошибке делегирует загрузку браузерному fetcher, если он передан.

### Парсинг LiveLib

`livelib.mjs` содержит правила домена LiveLib:

- нормализация и валидация wish-list URL;
- поиск страниц pagination только в рамках текущего пользователя;
- извлечение книг;
- извлечение описания, изображения и жанра со страницы книги;
- слияние свежих LiveLib книг с существующим JSON.

Слияние выполняется по `book.url`. Уже сохраненная запись получает скрытую
ссылку на свежую LiveLib запись через `LIVELIB_SOURCE_BOOK`, чтобы поисковые
запросы могли использовать актуальные title/authors, не перетирая поля
пользователя.

### Поисковые интеграции

Интеграции разделены по источникам:

- `yandex-books.mjs` строит поисковые URL, извлекает результаты Yandex Books,
  сопоставляет title/authors и разделяет обычные книги и аудиокниги.
- `litres-books.mjs` делает то же для Litres, включая фильтрацию рекламных
  блоков и JSON-LD данные аудиокниг.
- `rutracker-books.mjs` ищет RuTracker через TorAPI и работает с topic URL,
  названием, длительностью и чтецом аудиокниги.

Общий конструктор запроса находится в `book-search-query.mjs`, общая логика
сопоставления результатов для Litres находится в `book-search-match.mjs`.

### Обогащение деталей

`book-details-enrichment.mjs` объединяет обогащение аудиокниг и страниц LiveLib:

- выбирает только отсутствующие поля;
- не перезаписывает уже записанные description, image, genre, duration,
  narrator и title;
- собирает статистику enrichment;
- обновляет среднюю длительность `audiobook_duration_minutes`.

`audiobook-duration.mjs` содержит извлечение длительности и чтеца из HTML разных
источников. `audiobook-page-fields.mjs` предоставляет общий парсер полей вида
`Label: value`.

### JSON и нормализация ссылок

`json-output.mjs` отвечает за чтение HTML fallback, чтение существующего JSON и
атомарный для workflow вывод JSON в целевой путь.

`book-url-fields.mjs` нормализует модель аудиоссылок:

- поддерживает строки и объекты `{ url, title, narrator, duration }`;
- удаляет дубли по URL;
- объединяет новые данные с уже существующими;
- мигрирует legacy-поля `rutracker_urls` в общий `audiobooks_urls`.

`text-match.mjs` содержит низкоуровневую нормализацию текста, извлечение href и
token overlap.

## Модель данных

Основная единица результата:

```json
{
  "title": "string",
  "authors": ["string"],
  "url": "string",
  "yandex_books_urls": ["string"],
  "litres_urls": ["string"],
  "audiobooks_urls": [
    {
      "url": "string",
      "title": "string | null",
      "narrator": "string | null",
      "duration": "number | null"
    }
  ],
  "description": "string",
  "image": "string",
  "genre": "string | null",
  "audiobook_duration_minutes": "number"
}
```

Минимальные поля новой записи приходят из LiveLib: `title`, `authors`, `url`.
Поля обогащения добавляются только когда данные найдены. Существующие
пользовательские поля сохраняются при повторной выгрузке, если книга все еще
есть в LiveLib wish-list.

## Поток выполнения

```text
CLI args
  ↓
parseLivelibWishlistUrl()
  ↓
loadBooksJsonIfExists()
  ↓
fetchWishlistPages() или loadHtmlFile()
  ↓
extractBooksFromPages()
  ↓
mergeExistingLiveLibBooks()
  ↓
enrichBooksWithYandexBooksUrls()
  ↓
enrichBooksWithLitresUrls()
  ↓
enrichBooksWithRutrackerUrls()
  ↓
enrichBooksWithMissingDetails()
  ↓
writeBooksJson()
```

Обогащение выполняется последовательно. Между сетевыми запросами используется
фиксированная задержка, чтобы не создавать параллельных обращений к внешним
сайтам и не получать гонки при изменении книги.

## Внешние зависимости

- Node.js ESM.
- `cheerio` для HTML-парсинга.
- `playwright` для видимого браузера и persistent profile.
- Системный `curl` для прямой загрузки некоторых страниц деталей.

Сетевое состояние авторизации хранится только в локальном browser profile.
Логин Litres выполняется вручную пользователем в открытом браузере. Поиск
RuTracker идет через TorAPI и не требует авторизации.

## Ограничения безопасности

Архитектура следует ограничениям skill:

- открываются только URL, предоставленный пользователем, и страницы pagination
  того же LiveLib wish-list;
- login не автоматизируется;
- CAPTCHA и защитные механизмы не обходятся;
- существующие пользовательские поля не перезаписываются при enrichment;
- cookies, пароли и токены не сохраняются вне browser profile.

## Правила расширения

При добавлении нового источника лучше сохранить текущую форму:

1. Создать модуль `<source>-books.mjs`.
2. Разделить функции на build search URL, normalize URL, extract results,
   filter/match results и enrich books.
3. Использовать `buildBookSearchQuery()` и общие helpers из `text-match.mjs`.
4. Возвращать новые данные как новые объекты книг, не мутируя входной массив.
5. Не перезаписывать уже заполненные поля.
6. Передавать fetcher и sleep как зависимости, чтобы код оставался тестируемым.

Если источник возвращает аудиокниги, ссылки должны попадать в
`audiobooks_urls`, а не смешиваться с обычными книжными ссылками.
