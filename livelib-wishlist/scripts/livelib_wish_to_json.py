#!/usr/bin/env python3
"""Export a LiveLib wish-list page to JSON.

The current implementation validates a LiveLib wish-list URL and loads the HTML
page. Parsing and JSON writing belong to the next MVP steps.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import re
from dataclasses import dataclass
from email.message import Message
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from urllib.request import HTTPCookieProcessor, Request, build_opener


WISHLIST_PATH_RE = re.compile(r"^/reader/([^/]+)/wish/?$")
DEFAULT_TIMEOUT_SECONDS = 20
USER_AGENT = "livelib-wishlist-skill/0.1"


@dataclass(frozen=True)
class WishlistUrl:
    username: str
    url: str


@dataclass(frozen=True)
class FetchedHtml:
    url: str
    html: str


class LiveLibAccessError(RuntimeError):
    """Raised when LiveLib refuses or redirects the request."""


def parse_livelib_wishlist_url(raw_url: str) -> WishlistUrl:
    parsed = urlparse(raw_url)

    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL must use http or https")

    if parsed.netloc.lower() != "www.livelib.ru":
        raise ValueError("URL host must be www.livelib.ru")

    match = WISHLIST_PATH_RE.match(parsed.path)
    if not match:
        raise ValueError("URL path must look like /reader/<username>/wish")

    normalized = urlunparse(("https", parsed.netloc.lower(), parsed.path.rstrip("/"), "", "", ""))
    return WishlistUrl(username=match.group(1), url=normalized)


def _get_charset(headers: Message) -> str:
    content_type = headers.get("content-type", "")
    match = re.search(r"charset=([^;\s]+)", content_type, re.IGNORECASE)
    if match:
        return match.group(1).strip("\"'")
    return "utf-8"


def build_http_opener():
    cookie_jar = http.cookiejar.CookieJar()
    return build_opener(HTTPCookieProcessor(cookie_jar))


def fetch_html(url: str, timeout: int = DEFAULT_TIMEOUT_SECONDS, opener=None) -> FetchedHtml:
    if opener is None:
        opener = build_http_opener().open

    request = Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": USER_AGENT,
        },
    )
    response = opener(request, timeout=timeout)

    status = getattr(response, "status", None) or response.getcode()
    if status != 200:
        raise LiveLibAccessError(f"LiveLib returned HTTP {status}")

    body = response.read()
    charset = _get_charset(response.headers)
    html = body.decode(charset, errors="replace")
    final_url = response.geturl()

    if urlparse(final_url).path.rstrip("/") == "/loginform":
        raise LiveLibAccessError(
            "LiveLib redirected the request to /loginform. "
            "Open the wish-list page in a browser and save the page HTML, then run with --html."
        )

    return FetchedHtml(url=final_url, html=html)


def load_html_file(path: str) -> FetchedHtml:
    html_path = Path(path)
    return FetchedHtml(url=str(html_path), html=html_path.read_text(encoding="utf-8"))


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export a LiveLib wish-list page to JSON."
    )
    parser.add_argument(
        "url",
        help="LiveLib wish-list URL, e.g. https://www.livelib.ru/reader/LiraLantan/wish",
    )
    parser.add_argument(
        "--out",
        default="wishlist.json",
        help="Output JSON path. Default: wishlist.json",
    )
    parser.add_argument(
        "--html",
        help="Use a saved LiveLib wish-list HTML file instead of fetching the URL.",
    )
    return parser


def main() -> int:
    parser = build_arg_parser()
    args = parser.parse_args()

    try:
        wishlist_url = parse_livelib_wishlist_url(args.url)
    except ValueError as exc:
        parser.error(str(exc))

    if args.html:
        try:
            fetched = load_html_file(args.html)
        except OSError as exc:
            parser.error(f"failed to read HTML file: {exc}")
    else:
        try:
            fetched = fetch_html(wishlist_url.url)
        except OSError as exc:
            parser.error(f"failed to load HTML: {exc}")
        except LiveLibAccessError as exc:
            parser.error(str(exc))

    print(f"Accepted LiveLib wish-list URL for user {wishlist_url.username}: {wishlist_url.url}")
    print(f"Loaded HTML from {fetched.url}: {len(fetched.html)} characters")
    print(f"Output path: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
