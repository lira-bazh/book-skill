---
name: livelib-wishlist
description: Use this skill when the user provides a LiveLib wish-list URL like https://www.livelib.ru/reader/<username>/wish and wants to save the books as JSON with title, authors, and LiveLib book URL.
---

# LiveLib Wishlist

Use this skill when the user provides a LiveLib wish-list URL:

```text
https://www.livelib.ru/reader/<username>/wish
```

## Workflow

1. Validate that the URL points to `www.livelib.ru/reader/<username>/wish`.
2. Run `scripts/livelib-wish-to-json.mjs` with `--browser`, a persistent profile directory, and a sensible `--max-pages` limit.
3. Open LiveLib in a visible browser window.
4. If LiveLib asks for login or verification, let the user complete it manually.
5. Process the first page and all pagination pages for the same user's wish-list.
6. Save the result to the requested JSON path, or use the script default.
7. Tell the user the output path, how many books were saved, and how many pages were processed.

Direct HTTP and `--html` may remain as fallbacks, but the main user workflow is
browser mode with manual authorization.

## Current Scope

The skill only needs these fields for each book:

```json
{
  "title": "string",
  "authors": ["string"],
  "url": "string"
}
```

## Constraints

- Request/open only the URL provided by the user and pagination pages for that same wish-list.
- Do not automate login.
- Do not bypass CAPTCHAs or protective mechanisms.
- Do not crawl or scan other LiveLib sections.
- Use a maximum page limit when following pagination.
- Keep authorization state only in the local browser profile.
- Do not save extra fields unless the user asks for them.
