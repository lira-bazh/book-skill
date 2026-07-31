import { load, type CheerioAPI } from 'cheerio';

import { cleanText } from './text-match.mjs';

type ExtractLabeledPageTextValueOptions = {
  stopLabels?: readonly string[];
};

export function extractLabeledPageTextValue(
  html: unknown,
  labels: readonly string[],
  { stopLabels = labels }: ExtractLabeledPageTextValueOptions = {},
): string | null {
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

function extractValueFromLabeledElement(
  $: CheerioAPI,
  labels: readonly string[],
  stopLabels: readonly string[],
): string | null {
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

function extractValueFromText(
  value: unknown,
  labels: readonly string[],
  stopLabels: readonly string[],
): string | null {
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

  return cleanText(valueMatch[1]?.replace(/^[,;:]+|[,;:]+$/gu, '')) || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
