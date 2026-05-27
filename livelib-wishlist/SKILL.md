---
name: livelib-wishlist
description: Use this skill when the user provides a LiveLib wish-list URL like https://www.livelib.ru/reader/<username>/wish and wants to save the books as JSON with title, authors, LiveLib book URL, matching book links, description, and cover image.
---

# LiveLib Wishlist

Use this skill when the user provides a LiveLib wish-list URL:

```text
https://www.livelib.ru/reader/<username>/wish
```

## Workflow

1. Validate that the URL points to `www.livelib.ru/reader/<username>/wish`.
2. Run `scripts/livelib-wish-to-json.mjs` with a persistent profile directory, a sensible `--max-pages` limit, and optional `--max-results`.
3. Open LiveLib in a visible browser window.
4. Process the first page and all pagination pages for the same user's public wish-list.
5. Search matching books on Yandex Books and Litres for books without existing saved links.
6. If Litres requires authentication, keep the visible browser open and ask the user to sign in manually; continue only after the user confirms the login is complete.
7. Open LiveLib book pages for books without saved `description` or `image`, then fill only the missing fields.
8. Save the result to the requested JSON path, or use the script default.
9. Tell the user the output path, how many books were saved, how many pages were processed, and enrichment statistics.

Direct HTTP and `--html` may remain as fallbacks, but the main user workflow is
browser mode.

## Current Scope

The skill saves these fields for each book:

```json
{
  "title": "string",
  "authors": ["string"],
  "url": "string",
  "yandex_books_urls": ["string"],
  "litres_urls": ["string"],
  "description": "string",
  "image": "string",
  "genre": "string | null"
}
```

Existing JSON data for books still present on LiveLib must be preserved, including
additional user fields and already filled `yandex_books_urls`, `litres_urls`,
`description`, `image`, `genre`, or `audiobook_duration_minutes`. `description`,
`image`, and `genre` are optional fields: if LiveLib page details are not found,
the fields may be absent. Existing `genre` values, including `null`, must not be
overwritten during enrichment.

## CLI

Main workflow:

```bash
node scripts/livelib-wish-to-json.mjs \
  "https://www.livelib.ru/reader/<username>/wish" \
  --profile-dir livelib-wishlist/.browser-profile \
  --out wishlist.json \
  --max-pages 50 \
  --max-results 5
```

`--max-results` is the universal per-book limit for each search enrichment.

## Constraints

- Request/open only the URL provided by the user and pagination pages for that same wish-list.
- Do not automate login; Litres login is manual in the visible browser.
- Do not bypass CAPTCHAs or protective mechanisms.
- Do not crawl or scan other LiveLib sections.
- Use a maximum page limit when following pagination.
- Keep authorization state only in the local browser profile.
- Do not save cookies, passwords, tokens, or Litres session data outside the browser profile.
- Do not overwrite existing user fields while enriching links or LiveLib book page details.
