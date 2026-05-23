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
2. Run `scripts/livelib_wish_to_json.py` with the URL.
3. Process the first page and all pagination pages for the same user's wish-list.
4. Save the result to the requested JSON path, or use the script default.
5. Tell the user the output path, how many books were saved, and how many pages were processed.

If LiveLib returns `403 Forbidden` or redirects to `/loginform`, do not try to
bypass protection or automate login. Ask the user to open the wish-list page in
their browser, save the HTML page, and rerun the script with `--html`.

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

- Request only the URL provided by the user and pagination pages for that same wish-list.
- Do not automate login.
- Do not bypass CAPTCHAs or protective mechanisms.
- Do not crawl or scan other LiveLib sections.
- Use a maximum page limit when following pagination.
- Do not save extra fields unless the user asks for them.
