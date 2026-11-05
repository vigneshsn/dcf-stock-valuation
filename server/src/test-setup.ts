import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Keeps the on-disk FMP cache and call counter out of the real .cache directory and out of other test runs.
process.env.FMP_CACHE_DIR ||= mkdtempSync(path.join(tmpdir(), 'fmp-cache-'));
