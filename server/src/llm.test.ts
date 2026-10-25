import { test } from 'node:test';
import assert from 'node:assert';
import { generate, generateJson, llmConfig, LlmError, DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL, THINKING_HEADROOM_TOKENS } from './llm.js';

const LLM_ENV = [
  'LLM_PROVIDERS',
  'LLM_CONCURRENCY',
  'LLM_MAX_RETRIES',
  'LLM_MAX_RETRY_WAIT_MS',
  'LLM_TIMEOUT_MS',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GEMINI_REASONING_EFFORT',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'GROQ_REASONING_EFFORT',
  'OLLAMA_URL',
  'OLLAMA_MODEL',
  'OLLAMA_NUM_CTX',
  'OLLAMA_CONCURRENCY',
];

interface Call {
  url: string;
  headers: Record<string, string>;
  body: any;
}

async function withLlm(
  env: Record<string, string>,
  respond: (call: Call, index: number) => Response | Promise<Response>,
  run: (calls: Call[]) => Promise<void>
): Promise<void> {
  const saved = Object.fromEntries(LLM_ENV.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  for (const k of LLM_ENV) delete process.env[k];
  Object.assign(process.env, env);
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of LLM_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const chat = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const fail = (status: number, body = 'nope', headers: Record<string, string> = {}) => new Response(body, { status, headers });

test('generate caps concurrent Ollama requests and sends num_ctx/num_predict', async () => {
  let active = 0;
  let peak = 0;
  await withLlm(
    { OLLAMA_CONCURRENCY: '2', OLLAMA_NUM_CTX: '8192' },
    async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return new Response(JSON.stringify({ response: 'ok' }));
    },
    async (calls) => {
      const out = await Promise.all(Array.from({ length: 6 }, () => generate('hi', { maxTokens: 100 })));
      assert.deepStrictEqual(out, Array(6).fill('ok'));
      assert.strictEqual(peak, 2);
      assert.strictEqual(calls[0].url, 'http://localhost:11434/api/generate');
      assert.deepStrictEqual(calls[0].body.options, { num_ctx: 8192, num_predict: 100 });
    }
  );
});

test('llmConfig puts keyed cloud providers before local Ollama and keys caches on the primary model', async () => {
  await withLlm({}, () => fail(500), async () => {
    assert.deepStrictEqual(llmConfig().providers.map((p) => p.name), ['ollama']);
    assert.strictEqual(llmConfig().model, 'qwen3:8b');
  });
  await withLlm({ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' }, () => fail(500), async () => {
    assert.deepStrictEqual(llmConfig().providers.map((p) => p.name), ['gemini', 'groq', 'ollama']);
    assert.strictEqual(llmConfig().model, DEFAULT_GEMINI_MODEL);
  });
});

test('LLM_PROVIDERS sets the order explicitly and ignores unknown names', async () => {
  await withLlm({ LLM_PROVIDERS: 'groq, bogus, ollama, groq', GEMINI_API_KEY: 'g' }, () => fail(500), async () => {
    assert.deepStrictEqual(llmConfig().providers.map((p) => p.name), ['groq', 'ollama']);
  });
});

test('Gemini is called through its OpenAI-compatible endpoint with JSON mode and low thinking', async () => {
  await withLlm(
    { LLM_PROVIDERS: 'gemini', GEMINI_API_KEY: 'secret' },
    () => chat(' {"rating":"Wide"} '),
    async (calls) => {
      const out = await generateJson<{ rating: string }>('judge', 300);
      assert.deepStrictEqual(out, { rating: 'Wide' });
      assert.strictEqual(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
      assert.strictEqual(calls[0].headers.Authorization, 'Bearer secret');
      assert.deepStrictEqual(calls[0].body, {
        model: DEFAULT_GEMINI_MODEL,
        messages: [{ role: 'user', content: 'judge' }],
        stream: false,
        reasoning_effort: 'low',
        max_tokens: 300 + THINKING_HEADROOM_TOKENS,
        response_format: { type: 'json_object' },
      });
    }
  );
});

test('Groq uses its OpenAI-compatible endpoint with low reasoning by default', async () => {
  await withLlm({ LLM_PROVIDERS: 'groq', GROQ_API_KEY: 'k' }, () => chat('summary'), async (calls) => {
    assert.strictEqual(await generate('sum', { maxTokens: 200 }), 'summary');
    assert.strictEqual(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.strictEqual(calls[0].body.model, DEFAULT_GROQ_MODEL);
    assert.strictEqual(calls[0].body.reasoning_effort, 'low');
    assert.strictEqual(calls[0].body.max_tokens, 200 + THINKING_HEADROOM_TOKENS);
    assert.strictEqual('response_format' in calls[0].body, false);
  });
});

test('an empty reasoning effort omits it and the thinking headroom for non-reasoning models', async () => {
  await withLlm(
    { LLM_PROVIDERS: 'groq', GROQ_API_KEY: 'k', GROQ_MODEL: 'some-llama', GROQ_REASONING_EFFORT: '' },
    () => chat('ok'),
    async (calls) => {
      await generate('sum', { maxTokens: 200 });
      assert.strictEqual(calls[0].body.model, 'some-llama');
      assert.strictEqual(calls[0].body.max_tokens, 200);
      assert.strictEqual('reasoning_effort' in calls[0].body, false);
    }
  );
});

test('a failing provider falls back to the next one in order', async () => {
  await withLlm(
    { LLM_PROVIDERS: 'gemini,groq,ollama', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' },
    (call) => (call.url.includes('googleapis') ? fail(400, 'bad request') : call.url.includes('groq') ? chat('from groq') : fail(500)),
    async (calls) => {
      assert.strictEqual(await generate('x'), 'from groq');
      assert.deepStrictEqual(calls.map((c) => new URL(c.url).host), ['generativelanguage.googleapis.com', 'api.groq.com']);
    }
  );
});

test('a provider without an API key is skipped without a request', async () => {
  await withLlm({ LLM_PROVIDERS: 'gemini,ollama' }, () => new Response(JSON.stringify({ response: 'local' })), async (calls) => {
    assert.strictEqual(await generate('x'), 'local');
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /11434/);
  });
});

test('429 is retried on the same provider after Retry-After', async () => {
  await withLlm(
    { LLM_PROVIDERS: 'gemini,groq', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' },
    (_call, i) => (i === 0 ? fail(429, 'slow down', { 'retry-after': '0' }) : chat('gemini ok')),
    async (calls) => {
      assert.strictEqual(await generate('x'), 'gemini ok');
      assert.strictEqual(calls.length, 2);
      assert.ok(calls.every((c) => c.url.includes('googleapis')));
    }
  );
});

test('a rate limit longer than LLM_MAX_RETRY_WAIT_MS moves straight to the next provider', async () => {
  await withLlm(
    { LLM_PROVIDERS: 'gemini,groq', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', LLM_MAX_RETRY_WAIT_MS: '1000' },
    (call) =>
      call.url.includes('googleapis')
        ? fail(429, JSON.stringify({ error: { details: [{ retryDelay: '3600s' }] } }))
        : chat('groq ok'),
    async (calls) => {
      assert.strictEqual(await generate('x'), 'groq ok');
      assert.strictEqual(calls.length, 2);
    }
  );
});

test('when every provider fails the error names each of them', async () => {
  await withLlm(
    { LLM_PROVIDERS: 'gemini,groq', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', LLM_MAX_RETRIES: '0' },
    (call) => fail(call.url.includes('groq') ? 503 : 401, 'denied'),
    async () => {
      await assert.rejects(generate('x'), (err: unknown) => {
        assert.ok(err instanceof LlmError);
        assert.match(err.message, /Gemini request failed \(401\)/);
        assert.match(err.message, /Groq request failed \(503\)/);
        return true;
      });
    }
  );
});

test('an answer that is not valid JSON falls back to the next provider', async () => {
  await withLlm(
    { LLM_PROVIDERS: 'gemini,groq', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' },
    (call) => (call.url.includes('googleapis') ? chat('{"keyPoints": [ {"point": "cut') : chat('{"ok":true}')),
    async (calls) => {
      assert.deepStrictEqual(await generateJson('x'), { ok: true });
      assert.strictEqual(calls.length, 2);
    }
  );
});

test('a JSON answer cut off at max_tokens falls back, but plain text is accepted', async () => {
  const truncated = () =>
    new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"a":1}' } }] }));
  await withLlm(
    { LLM_PROVIDERS: 'gemini,groq', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' },
    (call) => (call.url.includes('googleapis') ? truncated() : chat('{"a":2}')),
    async (calls) => {
      assert.deepStrictEqual(await generateJson('x'), { a: 2 });
      assert.strictEqual(await generate('x'), '{"a":1}');
      assert.strictEqual(calls.length, 3);
    }
  );
});

test('invalid JSON from every provider reports each failure', async () => {
  await withLlm({ LLM_PROVIDERS: 'groq', GROQ_API_KEY: 'q' }, () => chat('not json'), async () => {
    await assert.rejects(generateJson('x'), (err: unknown) => err instanceof LlmError && /valid JSON/.test(err.message));
  });
});
