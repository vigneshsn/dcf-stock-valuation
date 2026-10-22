import { test } from 'node:test';
import assert from 'node:assert';
import { generate } from './ollama.js';

test('generate caps concurrent Ollama requests and sends num_ctx/num_predict', async () => {
  const realFetch = globalThis.fetch;
  process.env.OLLAMA_CONCURRENCY = '2';
  process.env.OLLAMA_NUM_CTX = '8192';
  let active = 0;
  let peak = 0;
  const bodies: any[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return new Response(JSON.stringify({ response: 'ok' }));
  }) as typeof fetch;
  try {
    const out = await Promise.all(Array.from({ length: 6 }, () => generate('hi', { maxTokens: 100 })));
    assert.deepStrictEqual(out, Array(6).fill('ok'));
    assert.strictEqual(peak, 2);
    assert.deepStrictEqual(bodies[0].options, { num_ctx: 8192, num_predict: 100 });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OLLAMA_CONCURRENCY;
    delete process.env.OLLAMA_NUM_CTX;
  }
});
