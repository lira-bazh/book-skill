import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function loadHtmlFile(path) {
  const html = await readFile(path, 'utf8');
  return { url: path, html };
}

export async function writeBooksJson(path, books) {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(books, null, 2)}\n`, 'utf8');
  return outputPath;
}
