import unittest
from email.message import Message
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.livelib_wish_to_json import (
    LiveLibAccessError,
    fetch_html,
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
