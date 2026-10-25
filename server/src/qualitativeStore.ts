import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Bump when the Moat / Management prompts or the response shape change.
export const QUALITATIVE_VERSION = 1;

// LLM judgements depend only on the year summaries (fingerprinted in the key), the model and the peers,
// so they are stored on disk and survive restarts.
export function qualitativeCacheDir(): string {
  return process.env.QUALITATIVE_CACHE_DIR || path.resolve(process.cwd(), '.cache', 'qualitative');
}

const tickerPrefix = (ticker: string) => `${ticker.toUpperCase().replace(/[^A-Z0-9.-]/g, '_')}__`;
const fileName = (ticker: string, key: string) =>
  `${tickerPrefix(ticker)}${createHash('sha1').update(key).digest('hex').slice(0, 16)}__v${QUALITATIVE_VERSION}.json`;

export async function readStoredQualitative<T>(ticker: string, key: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path.join(qualitativeCacheDir(), fileName(ticker, key)), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function writeStoredQualitative<T>(ticker: string, key: string, value: T): Promise<void> {
  const dir = qualitativeCacheDir();
  const target = path.join(dir, fileName(ticker, key));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, target);
  } catch (err: any) {
    console.error(`[qualitative cache] write failed for ${target}: ${err?.message || err}`);
  }
}

// Drops every stored judgement for the ticker; called when a report is uploaded.
export async function forgetStoredQualitative(ticker: string): Promise<void> {
  const dir = qualitativeCacheDir();
  const prefix = tickerPrefix(ticker);
  const files = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(files.filter((f) => f.startsWith(prefix)).map((f) => unlink(path.join(dir, f)).catch(() => undefined)));
}
