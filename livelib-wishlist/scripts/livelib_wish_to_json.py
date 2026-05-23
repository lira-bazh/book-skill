#!/usr/bin/env python3
"""Export a LiveLib wish-list print page to JSON.

This first implementation validates and normalizes the input URL. Fetching,
parsing, and JSON writing belong to the next MVP steps.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from urllib.parse import urlparse, urlunparse


WISHLIST_PATH_RE = re.compile(r"^/reader/([^/]+)/wish/print/?$")


@dataclass(frozen=True)
class WishlistUrl:
    username: str
    url: str


def parse_livelib_wishlist_url(raw_url: str) -> WishlistUrl:
    parsed = urlparse(raw_url)

    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL must use http or https")

    if parsed.netloc.lower() != "www.livelib.ru":
        raise ValueError("URL host must be www.livelib.ru")

    match = WISHLIST_PATH_RE.match(parsed.path)
    if not match:
        raise ValueError("URL path must look like /reader/<username>/wish/print")

    normalized = urlunparse(("https", parsed.netloc.lower(), parsed.path.rstrip("/"), "", "", ""))
    return WishlistUrl(username=match.group(1), url=normalized)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export a LiveLib wish-list print page to JSON."
    )
    parser.add_argument(
        "url",
        help="LiveLib wish-list print URL, e.g. https://www.livelib.ru/reader/LiraLantan/wish/print",
    )
    parser.add_argument(
        "--out",
        default="wishlist.json",
        help="Output JSON path. Default: wishlist.json",
    )
    return parser


def main() -> int:
    parser = build_arg_parser()
    args = parser.parse_args()

    try:
        wishlist_url = parse_livelib_wishlist_url(args.url)
    except ValueError as exc:
        parser.error(str(exc))

    print(f"Accepted LiveLib wish-list URL for user {wishlist_url.username}: {wishlist_url.url}")
    print(f"Output path: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
