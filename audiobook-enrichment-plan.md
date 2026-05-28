# План: обогащение аудиокниг рассказчиками

1. [x] Найти текущий поток обогащения аудиокниг в месте, где уже определяется `audiobook_duration_minutes`.
   Основные кандидаты: `livelib-wishlist/scripts/lib/audiobook-duration.mjs`, модули `litres-books.mjs`, `yandex-books.mjs`, `rutracker-books.mjs`, CLI-оркестратор.
   Найденный поток: CLI `livelib-wishlist/scripts/livelib-wish-to-json.mjs` после LiveLib merge последовательно запускает Yandex Books, Litres и RuTracker enrichment, затем вызывает `enrichBooksWithMissingDetails`.
   Длительность аудиокниги обогащается в `livelib-wishlist/scripts/lib/book-details-enrichment.mjs` через `firstAudiobookUrlForBook` и `extractAudiobookDurationMinutes` из `livelib-wishlist/scripts/lib/audiobook-duration.mjs`.
   Источники аудиоссылок сейчас собираются строками через `mergeAudiobookUrls`, `splitAudiobookUrls` и `audiobookUrlsForBook` в `livelib-wishlist/scripts/lib/book-url-fields.mjs`.
   Провайдеры добавляют ссылки так: Yandex Books и Litres переносят `/audiobooks/...` из своих полей в `audiobooks_urls`, RuTracker сразу пишет найденные topic URL в `audiobooks_urls`.

2. [x] Зафиксировать новую JSON-схему для ссылок на аудиокниги.
   Каждую ссылку на аудиокнигу преобразовать из строки в объект вида `{ url, narrator }`.
   Для обратной совместимости предусмотреть нормализацию старых строк при чтении существующего `--out`.
   Реализация: `book-url-fields.mjs` нормализует аудиоссылки в `{ url, narrator }`, `mergeAudiobookUrls` возвращает объекты, а `json-output.mjs` мигрирует старые строковые `audiobooks_urls` при чтении существующего JSON.

3. [x] Обновить merge существующего JSON.
   Сохранять уже заполненные `url`, `narrator` и `audiobook_duration_minutes`.
   Не затирать заполненного рассказчика пустым значением при повторном запуске.
   Реализация: `mergeExistingLiveLibBooks` сохраняет существующий объект книги и нормализует его `audiobooks_urls`; `mergeAudiobookUrls` сначала учитывает уже сохраненные аудиоссылки и заменяет запись только если у старой нет `narrator`, а у новой он заполнен.

4. [x] Добавить извлечение рассказчика при первичном добавлении ссылки Rutracker.
   В названии результата найти элемент с `class="brackets-pair"` и достать из квадратных скобок часть до первой запятой: `[[рассказчик], ...]`.
   Сохранять найденное значение в поле `narrator` объекта ссылки.
   Реализация: `extractRutrackerSearchResults` читает `.brackets-pair`, `extractMatchingRutrackerAudiobookEntries` возвращает `{ url, narrator }`, а первичное RuTracker enrichment передает эти объекты в `mergeAudiobookUrls`.

5. [x] Расширить проверку ссылок на аудиокниги.
   Если у книги не заполнено `audiobook_duration_minutes`, перейти по первой ссылке аудиокниги и взять длительность.
   Для Litres и Yandex Books использовать существующую логику; для Rutracker добавить поиск поля `Время звучания`.
   Реализация: `firstAudiobookUrlForBook` выбирает первую ссылку Yandex Books/Litres/RuTracker, браузерный `fetchAudiobookPage` разрешает RuTracker topic URL, а `extractAudiobookDurationMinutes` сначала ищет значение после подписи `Время звучания`.

6. [x] Добавить обогащение рассказчика при проверке ссылок.
   Если у объекта аудиокниги не заполнен `narrator`, перейти по его ссылке и заполнить поле.
   Искать подписи: `Рассказчик` для Yandex Books, `Чтец` для Litres, `Исполнитель` для Rutracker.
   Реализация: `extractAudiobookNarrator` ищет подписи `Рассказчик`, `Чтец`, `Исполнитель`; `enrichBookWithMissingDetails` fetch-ит аудиоссылку, если не хватает длительности или рассказчика, и дозаполняет `audiobooks_urls` через `mergeAudiobookUrls` без затирания существующего `narrator`.

7. [x] Разнести парсинг по провайдерам.
   Провайдерские селекторы и текстовые маркеры держать в соответствующих модулях, а общий код нормализации объектов аудиоссылок вынести в shared helper, если это уменьшит дублирование.
   Реализация: подписи `Рассказчик`, `Чтец`, `Исполнитель` и `Время звучания` вынесены в модули `yandex-books.mjs`, `litres-books.mjs`, `rutracker-books.mjs`; общий поиск значения по подписи лежит в `audiobook-page-fields.mjs`, а `audiobook-duration.mjs` только оркестрирует провайдерские extractor'ы.

8. Обновить тесты без сетевых запросов.
   Добавить fake HTML/страницы для Rutracker с `brackets-pair`, `Время звучания`, `Исполнитель`.
   Добавить кейсы для Litres `Чтец`, Yandex Books `Рассказчик`, миграции строковых ссылок в объекты и сохранения уже заполненных значений.

9. Проверка пользователем после реализации:
   `pnpm test`
