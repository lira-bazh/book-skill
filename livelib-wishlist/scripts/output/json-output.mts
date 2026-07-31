import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { normalizeBookAudiobookUrls } from '../books/book-url-fields.mjs';

type HtmlPage = {
  url: string;
  html: string;
};

type JsonBook = Record<string, unknown>;

type ErrorWithCode = Error & {
  code?: string;
};

export async function loadHtmlFile(path: string): Promise<HtmlPage> {
  const html = await readFile(path, 'utf8');
  return { url: path, html };
}

export async function booksJsonExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function writeBooksJson(path: string, books: readonly unknown[]): Promise<string> {
  const outputPath = resolve(path);
  const temporaryOutputPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(dirname(outputPath), { recursive: true });

  try {
    await writeFile(temporaryOutputPath, `${JSON.stringify(books, null, 2)}\n`, 'utf8');
    await rename(temporaryOutputPath, outputPath);
  } catch (error) {
    await unlink(temporaryOutputPath).catch(() => {});
    throw error;
  }

  return outputPath;
}

export async function loadBooksJsonIfExists(path: string): Promise<JsonBook[]> {
  try {
    const json = await readFile(path, 'utf8');
    const books: unknown = JSON.parse(json);
    if (!Array.isArray(books)) {
      throw new Error('Existing JSON must contain an array');
    }

    return books.map((book) => normalizeBookAudiobookUrls(book) as JsonBook);
  } catch (error) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return typeof error === 'object' && error !== null && 'code' in error;
}
