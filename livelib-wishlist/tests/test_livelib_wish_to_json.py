import unittest
from email.message import Message
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.livelib_wish_to_json import (
    LiveLibAccessError,
    WishlistUrl,
    extract_wishlist_page_urls,
    fetch_html,
    fetch_wishlist_pages,
    load_html_file,
    parse_livelib_wishlist_url,
)


class WishlistUrlTest(unittest.TestCase):
    def test_accepts_livelib_wishlist_url(self):
        result = parse_livelib_wishlist_url(
            "https://www.livelib.ru/reader/LiraLantan/wish"
        )

        self.assertEqual(result.username, "LiraLantan")
        self.assertEqual(result.url, "https://www.livelib.ru/reader/LiraLantan/wish")

    def test_normalizes_trailing_slash(self):
        result = parse_livelib_wishlist_url(
            "http://www.livelib.ru/reader/LiraLantan/wish/"
        )

        self.assertEqual(result.url, "https://www.livelib.ru/reader/LiraLantan/wish")

    def test_rejects_non_wishlist_urls(self):
        urls = [
            "https://www.livelib.ru/reader/LiraLantan/wish/print",
            "https://www.livelib.ru/reader/LiraLantan/read/print",
            "https://livelib.ru/reader/LiraLantan/wish",
            "ftp://www.livelib.ru/reader/LiraLantan/wish",
        ]

        for url in urls:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    parse_livelib_wishlist_url(url)

class FakeResponse:
    def __init__(
        self,
        body=b"<html><body>ok</body></html>",
        status=200,
        url="https://www.livelib.ru/reader/LiraLantan/wish",
        content_type="text/html; charset=utf-8",
    ):
        self._body = body
        self.status = status
        self._url = url
        self.headers = Message()
        self.headers["content-type"] = content_type

    def getcode(self):
        return self.status

    def geturl(self):
        return self._url

    def read(self):
        return self._body


class FetchHtmlTest(unittest.TestCase):
    def test_fetches_html_with_expected_request(self):
        calls = []

        def opener(request, timeout):
            calls.append((request, timeout))
            return FakeResponse()

        result = fetch_html(
            "https://www.livelib.ru/reader/LiraLantan/wish",
            timeout=7,
            opener=opener,
        )

        self.assertEqual(result.html, "<html><body>ok</body></html>")
        self.assertEqual(result.url, "https://www.livelib.ru/reader/LiraLantan/wish")
        self.assertEqual(len(calls), 1)
        request, timeout = calls[0]
        self.assertEqual(request.full_url, "https://www.livelib.ru/reader/LiraLantan/wish")
        self.assertEqual(request.get_header("Accept"), "text/html,application/xhtml+xml")
        self.assertEqual(request.get_header("User-agent"), "livelib-wishlist-skill/0.1")
        self.assertEqual(timeout, 7)

    def test_fetch_uses_response_charset(self):
        def opener(request, timeout):
            return FakeResponse("Привет".encode("cp1251"), content_type="text/html; charset=windows-1251")

        result = fetch_html(
            "https://www.livelib.ru/reader/LiraLantan/wish",
            opener=opener,
        )

        self.assertEqual(result.html, "Привет")

    def test_fetch_rejects_non_200_response(self):
        def opener(request, timeout):
            return FakeResponse(status=404)

        with self.assertRaises(LiveLibAccessError):
            fetch_html(
                "https://www.livelib.ru/reader/LiraLantan/wish",
                opener=opener,
            )

    def test_fetch_rejects_login_redirect(self):
        def opener(request, timeout):
            return FakeResponse(url="https://www.livelib.ru/loginform")

        with self.assertRaises(LiveLibAccessError):
            fetch_html(
                "https://www.livelib.ru/reader/LiraLantan/wish",
                opener=opener,
            )


class PaginationTest(unittest.TestCase):
    def test_extracts_only_same_wishlist_page_urls(self):
        html = """
        <a href="/reader/LiraLantan/wish?page=2">2</a>
        <a href="https://www.livelib.ru/reader/LiraLantan/wish?page=3">3</a>
        <a href="/reader/LiraLantan/read?page=2">read</a>
        <a href="/reader/OtherUser/wish?page=2">other</a>
        <a href="/book/100000">book</a>
        <a href="/reader/LiraLantan/wish?page=2">duplicate</a>
        """

        urls = extract_wishlist_page_urls(
            html,
            username="LiraLantan",
            base_url="https://www.livelib.ru/reader/LiraLantan/wish",
        )

        self.assertEqual(
            urls,
            [
                "https://www.livelib.ru/reader/LiraLantan/wish?page=2",
                "https://www.livelib.ru/reader/LiraLantan/wish?page=3",
            ],
        )

    def test_fetches_paginated_wishlist_pages(self):
        pages = {
            "https://www.livelib.ru/reader/LiraLantan/wish": """
                <html><a href="/reader/LiraLantan/wish?page=2">2</a></html>
            """,
            "https://www.livelib.ru/reader/LiraLantan/wish?page=2": """
                <html><a href="/reader/LiraLantan/wish?page=2">2</a></html>
            """,
        }
        calls = []

        def opener(request, timeout):
            calls.append(request.full_url)
            return FakeResponse(
                body=pages[request.full_url].encode("utf-8"),
                url=request.full_url,
            )

        result = fetch_wishlist_pages(
            WishlistUrl(username="LiraLantan", url="https://www.livelib.ru/reader/LiraLantan/wish"),
            opener=opener,
        )

        self.assertEqual(calls, list(pages.keys()))
        self.assertEqual([page.url for page in result], list(pages.keys()))

    def test_fetch_respects_max_pages(self):
        pages = {
            "https://www.livelib.ru/reader/LiraLantan/wish": """
                <html><a href="/reader/LiraLantan/wish?page=2">2</a></html>
            """,
            "https://www.livelib.ru/reader/LiraLantan/wish?page=2": """
                <html><a href="/reader/LiraLantan/wish?page=3">3</a></html>
            """,
        }
        calls = []

        def opener(request, timeout):
            calls.append(request.full_url)
            return FakeResponse(
                body=pages[request.full_url].encode("utf-8"),
                url=request.full_url,
            )

        result = fetch_wishlist_pages(
            WishlistUrl(username="LiraLantan", url="https://www.livelib.ru/reader/LiraLantan/wish"),
            max_pages=1,
            opener=opener,
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(calls, ["https://www.livelib.ru/reader/LiraLantan/wish"])

    def test_rejects_zero_max_pages(self):
        with self.assertRaises(ValueError):
            fetch_wishlist_pages(
                WishlistUrl(username="LiraLantan", url="https://www.livelib.ru/reader/LiraLantan/wish"),
                max_pages=0,
                opener=lambda request, timeout: FakeResponse(),
            )


class LoadHtmlFileTest(unittest.TestCase):
    def test_loads_saved_html_file(self):
        with TemporaryDirectory() as directory:
            html_path = Path(directory) / "wish.html"
            html_path.write_text("<html>saved</html>", encoding="utf-8")

            result = load_html_file(str(html_path))

        self.assertEqual(result.url, str(html_path))
        self.assertEqual(result.html, "<html>saved</html>")


if __name__ == "__main__":
    unittest.main()
