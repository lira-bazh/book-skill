import { load } from 'cheerio';

import { cleanText } from './text-match.mjs';

export function extractLabeledPageTextValue(html, labels, { stopLabels = labels } = {}) {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  const normalizedLabels = labels
    .map((label) => cleanText(label))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (normalizedLabels.length === 0) {
    return null;
  }

  const $ = load(html);
  return extractValueFromLabeledElement($, normalizedLabels, stopLabels)
    ?? extractValueFromText($('body').text(), normalizedLabels, stopLabels);
}

function extractValueFromLabeledElement($, labels, stopLabels) {
  for (const element of $('body *').toArray()) {
    const node = $(element);
    const ownText = cleanText(node.clone().children().remove().end().text()).replace(/:$/u, '');
    const label = labels.find((candidate) => ownText === candidate);
    if (!label) {
      continue;
    }

    const value = extractValueFromText(node.parent().text(), [label], stopLabels);
    if (value) {
      return value;
    }
  }

  return null;
}

function extractValueFromText(value, labels, stopLabels) {
  const text = cleanText(value);
  if (!text) {
    return null;
  }

  const labelsPattern = labels.map(escapeRegExp).join('|');
  const stopLabelsPattern = stopLabels.map(escapeRegExp).join('|');
  const stopPattern = stopLabelsPattern ? `\\s+(?:${stopLabelsPattern})\\s*:?` : '$';
  const valueMatch = text.match(
    new RegExp(`(?:${labelsPattern})\\s*:?\\s*(.+?)(?=${stopPattern}|$)`, 'iu'),
  );
  if (!valueMatch) {
    return null;
  }

  return cleanText(valueMatch[1].replace(/^[,;:]+|[,;:]+$/gu, '')) || null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
