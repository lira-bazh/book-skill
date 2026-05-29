export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function stripParentheticalText(value) {
  let text = String(value ?? '');
  let previousText;

  do {
    previousText = text;
    text = text.replace(/\s*\([^()]*\)\s*/gu, ' ');
  } while (text !== previousText);

  return cleanText(text);
}

export function extractHrefValues(html) {
  const hrefs = [];
  const linkRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;

  while ((match = linkRe.exec(html)) !== null) {
    hrefs.push(match[1] ?? match[2] ?? match[3]);
  }

  return hrefs;
}

export function normalizeForMatch(value) {
  return stripParentheticalText(value)
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchTokens(value) {
  return normalizeForMatch(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

export function hasTokenOverlap(sourceValue, candidateValue, threshold = 0.8) {
  const sourceTokens = matchTokens(sourceValue);
  if (sourceTokens.length === 0) {
    return false;
  }

  const candidateTokens = new Set(matchTokens(candidateValue));
  const matchedTokens = sourceTokens.filter((token) => candidateTokens.has(token));
  return matchedTokens.length / sourceTokens.length >= threshold;
}
