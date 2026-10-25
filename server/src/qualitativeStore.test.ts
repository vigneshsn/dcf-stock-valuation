import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { forgetStoredQualitative, readStoredQualitative, writeStoredQualitative } from './qualitativeStore.js';

test('qualitative store keeps judgements per ticker and key until the ticker is forgotten', async () => {
  process.env.QUALITATIVE_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'qual-'));
  await writeStoredQualitative('abc', 'management:m:f1', { score: 1 });
  await writeStoredQualitative('XYZ', 'management:m:f1', { score: 2 });

  assert.deepEqual(await readStoredQualitative('ABC', 'management:m:f1'), { score: 1 });
  assert.equal(await readStoredQualitative('ABC', 'management:m:f2'), undefined);

  await forgetStoredQualitative('ABC');
  assert.equal(await readStoredQualitative('ABC', 'management:m:f1'), undefined);
  assert.deepEqual(await readStoredQualitative('XYZ', 'management:m:f1'), { score: 2 });
});
