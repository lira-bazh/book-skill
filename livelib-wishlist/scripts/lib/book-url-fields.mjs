export function isAudiobookUrl(rawUrl) {
  return typeof rawUrl === 'string' && rawUrl.toLowerCase().includes('audiobook');
}

export function isRutrackerUrl(rawUrl) {
  if (typeof rawUrl !== 'string') {
    return false;
  }

  try {
    return new URL(rawUrl).hostname.toLowerCase().endsWith('rutracker.org');
  } catch {
    return rawUrl.toLowerCase().includes('rutracker.org/');
  }
}

export function uniqueUrls(urls) {
  const seen = new Set();
  const result = [];

  for (const url of urls) {
    if (typeof url !== 'string' || seen.has(url)) {
      continue;
    }
    seen.add(url);
    result.push(url);
  }

  return result;
}

export function splitAudiobookUrls(urls) {
  const regularUrls = [];
  const audiobookUrls = [];

  for (const url of Array.isArray(urls) ? urls : []) {
    if (isAudiobookUrl(url) || isRutrackerUrl(url)) {
      audiobookUrls.push(url);
    } else {
      regularUrls.push(url);
    }
  }

  return {
    regularUrls: uniqueUrls(regularUrls),
    audiobookUrls: uniqueUrls(audiobookUrls),
  };
}

export function mergeAudiobookUrls(book, urls) {
  return uniqueUrls([
    ...(Array.isArray(book?.audiobooks_urls) ? book.audiobooks_urls : []),
    ...urls,
  ]);
}

export function audiobookUrlsForBook(book) {
  return uniqueUrls([
    ...(Array.isArray(book?.audiobooks_urls) ? book.audiobooks_urls : []),
    ...splitAudiobookUrls(book?.yandex_books_urls).audiobookUrls,
    ...splitAudiobookUrls(book?.litres_urls).audiobookUrls,
    ...(Array.isArray(book?.rutracker_urls) ? book.rutracker_urls : []),
  ]);
}
