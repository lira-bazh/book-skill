import unittest

from scripts.livelib_wish_to_json import parse_livelib_wishlist_url


class WishlistUrlTest(unittest.TestCase):
    def test_accepts_livelib_wishlist_print_url(self):
        result = parse_livelib_wishlist_url(
            "https://www.livelib.ru/reader/LiraLantan/wish/print"
        )

        self.assertEqual(result.username, "LiraLantan")
        self.assertEqual(result.url, "https://www.livelib.ru/reader/LiraLantan/wish/print")

    def test_normalizes_trailing_slash(self):
        result = parse_livelib_wishlist_url(
            "http://www.livelib.ru/reader/LiraLantan/wish/print/"
        )

        self.assertEqual(result.url, "https://www.livelib.ru/reader/LiraLantan/wish/print")

    def test_rejects_non_wishlist_print_urls(self):
        urls = [
            "https://www.livelib.ru/reader/LiraLantan/wish",
            "https://www.livelib.ru/reader/LiraLantan/read/print",
            "https://livelib.ru/reader/LiraLantan/wish/print",
            "ftp://www.livelib.ru/reader/LiraLantan/wish/print",
        ]

        for url in urls:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    parse_livelib_wishlist_url(url)


if __name__ == "__main__":
    unittest.main()
