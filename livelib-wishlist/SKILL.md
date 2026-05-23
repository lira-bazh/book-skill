---
name: livelib-wishlist
description: Use this skill when the user provides a LiveLib wish-list print URL like https://www.livelib.ru/reader/<username>/wish/print and wants to save the books as JSON with title, authors, and LiveLib book URL.
---

# LiveLib Wishlist

Use this skill when the user provides a LiveLib wish-list print URL:

```text
https://www.livelib.ru/reader/<username>/wish/print
```

## Workflow

1. Validate that the URL points to `www.livelib.ru/reader/<username>/wish/print`.
2. Run `scripts/livelib_wish_to_json.py` with the URL.
3. Save the result to the requested JSON path, or use the script default.
4. Tell the user the output path and how many books were saved.

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

- Make one request only to the URL provided by the user.
- Do not automate login.
- Do not bypass CAPTCHAs or protective mechanisms.
- Do not crawl or scan other LiveLib pages.
- Do not save extra fields unless the user asks for them.
