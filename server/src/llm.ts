export type LlmProviderName = 'gemini' | 'groq' | 'ollama';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
// Gemini 3 models cannot turn thinking off, and some reject 'minimal'.
export const DEFAULT_GEMINI_REASONING_EFFORT = 'low';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_GROQ_REASONING_EFFORT = 'low';
export const DEFAULT_OLLAMA_MODEL = 'qwen3:8b';
export const DEFAULT_OLLAMA_NUM_CTX = 8192;
export const DEFAULT_LLM_CONCURRENCY = 4;
export const DEFAULT_LLM_MAX_RETRIES = 2;
export const DEFAULT_LLM_MAX_RETRY_WAIT_MS = 30_000;
export const DEFAULT_LLM_TIMEOUT_MS = 60_000;
// Thinking tokens count against max_tokens, so reasoning models get headroom on top of the requested answer length.
export const THINKING_HEADROOM_TOKENS = 1024;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const PROVIDER_NAMES: readonly LlmProviderName[] = ['gemini', 'groq', 'ollama'];

interface OpenAiCompatibleProvider {
  kind: 'openai';
  name: LlmProviderName;
  label: string;
  baseUrl: string;
  apiKey: string | undefined;
  apiKeyEnv: string;
  model: string;
  reasoningEffort: string | undefined;
}

interface OllamaProvider {
  kind: 'ollama';
  name: 'ollama';
  label: string;
  baseUrl: string;
  model: string;
  numCtx: number;
}

export type LlmProvider = OpenAiCompatibleProvider | OllamaProvider;

const positiveInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const nonNegativeInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
};

const trimSlash = (url: string) => url.replace(/\/$/, '');
const optional = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);
// Unset uses the default; set but empty omits reasoning_effort (for non-reasoning models).
const reasoningEffort = (v: string | undefined, fallback: string) => (v === undefined ? fallback : optional(v));

function providerConfig(name: LlmProviderName): LlmProvider {
  const env = process.env;
  switch (name) {
    case 'gemini':
      return {
        kind: 'openai',
        name,
        label: 'Gemini',
        baseUrl: GEMINI_BASE_URL,
        apiKey: optional(env.GEMINI_API_KEY),
        apiKeyEnv: 'GEMINI_API_KEY',
        model: optional(env.GEMINI_MODEL) ?? DEFAULT_GEMINI_MODEL,
        reasoningEffort: reasoningEffort(env.GEMINI_REASONING_EFFORT, DEFAULT_GEMINI_REASONING_EFFORT),
      };
    case 'groq':
      return {
        kind: 'openai',
        name,
        label: 'Groq',
        baseUrl: GROQ_BASE_URL,
        apiKey: optional(env.GROQ_API_KEY),
        apiKeyEnv: 'GROQ_API_KEY',
        model: optional(env.GROQ_MODEL) ?? DEFAULT_GROQ_MODEL,
        reasoningEffort: reasoningEffort(env.GROQ_REASONING_EFFORT, DEFAULT_GROQ_REASONING_EFFORT),
      };
    case 'ollama':
      return {
        kind: 'ollama',
        name,
        label: 'Ollama',
        baseUrl: trimSlash(env.OLLAMA_URL || 'http://localhost:11434'),
        model: optional(env.OLLAMA_MODEL) ?? DEFAULT_OLLAMA_MODEL,
        numCtx: positiveInt(env.OLLAMA_NUM_CTX, DEFAULT_OLLAMA_NUM_CTX),
      };
  }
}

const isProviderName = (s: string): s is LlmProviderName => (PROVIDER_NAMES as readonly string[]).includes(s);
const warnedUnknown = new Set<string>();

// Explicit LLM_PROVIDERS wins; otherwise every provider with an API key is tried before local Ollama.
function providerNames(): LlmProviderName[] {
  const configured = (process.env.LLM_PROVIDERS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const name of configured.filter((n) => !isProviderName(n) && !warnedUnknown.has(n))) {
    warnedUnknown.add(name);
    console.warn(`[llm] ignoring unknown provider "${name}" in LLM_PROVIDERS (expected ${PROVIDER_NAMES.join(', ')})`);
  }
  const valid = [...new Set(configured.filter(isProviderName))];
  if (valid.length) {
    return valid;
  }
  return [
    ...(optional(process.env.GEMINI_API_KEY) ? (['gemini'] as const) : []),
    ...(optional(process.env.GROQ_API_KEY) ? (['groq'] as const) : []),
    'ollama',
  ];
}

export function llmConfig() {
  const providers = providerNames().map(providerConfig);
  return {
    providers,
    // Caches are keyed on the primary model, so an answer from a fallback provider is stored under the same key.
    model: providers[0].model,
    concurrency: positiveInt(process.env.LLM_CONCURRENCY ?? process.env.OLLAMA_CONCURRENCY, DEFAULT_LLM_CONCURRENCY),
    maxRetries: nonNegativeInt(process.env.LLM_MAX_RETRIES, DEFAULT_LLM_MAX_RETRIES),
    maxRetryWaitMs: nonNegativeInt(process.env.LLM_MAX_RETRY_WAIT_MS, DEFAULT_LLM_MAX_RETRY_WAIT_MS),
    timeoutMs: positiveInt(process.env.LLM_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS),
  };
}

type LlmConfig = ReturnType<typeof llmConfig>;

export class LlmError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, opts: { retryable?: boolean; retryAfterMs?: number } = {}) {
    super(message);
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

// Process-wide cap on in-flight requests so parallel callers queue here rather than hit provider rate limits or Ollama's queue.
let active = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(limit: number): Promise<void> {
  if (active < limit) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) {
    next();
  } else {
    active--;
  }
}

export interface GenerateOptions {
  json?: boolean;
  maxTokens?: number;
}

export function generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  return generateAccepted(prompt, opts, (text) => text);
}

async function generateAccepted<T>(prompt: string, opts: GenerateOptions, accept: (text: string) => T): Promise<T> {
  const config = llmConfig();
  await acquireSlot(config.concurrency);
  try {
    return await generateWithFallback(prompt, opts, config, accept);
  } finally {
    releaseSlot();
  }
}

// An answer that `accept` rejects (e.g. invalid JSON) counts as that provider failing, so the next one is tried.
async function generateWithFallback<T>(prompt: string, opts: GenerateOptions, config: LlmConfig, accept: (text: string) => T): Promise<T> {
  const failures: string[] = [];
  for (const provider of config.providers) {
    try {
      const text = await withRetries(() => requestGenerate(provider, prompt, opts, config.timeoutMs), config);
      return accept(text);
    } catch (err: any) {
      const message = err?.message || String(err);
      failures.push(message);
      if (config.providers.length > 1) {
        console.warn(`[llm] ${provider.label} (${provider.model}) failed: ${message}`);
      }
    }
  }
  throw new LlmError(failures.length === 1 ? failures[0] : `All LLM providers failed: ${failures.join(' | ')}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetries<T>(call: () => Promise<T>, config: LlmConfig): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof LlmError) || !err.retryable || attempt >= config.maxRetries) {
        throw err;
      }
      const waitMs = err.retryAfterMs ?? 1000 * 2 ** attempt;
      // A long wait usually means a daily quota is spent; moving to the next provider is faster.
      if (waitMs > config.maxRetryWaitMs) {
        throw err;
      }
      await sleep(waitMs);
    }
  }
}

function requestGenerate(provider: LlmProvider, prompt: string, opts: GenerateOptions, timeoutMs: number): Promise<string> {
  return provider.kind === 'ollama'
    ? requestOllama(provider, prompt, opts)
    : requestOpenAiCompatible(provider, prompt, opts, timeoutMs);
}

async function requestOllama(provider: OllamaProvider, prompt: string, opts: GenerateOptions): Promise<string> {
  const options: Record<string, number> = { num_ctx: provider.numCtx };
  if (opts.maxTokens) {
    options.num_predict = opts.maxTokens;
  }
  // Disable reasoning traces on thinking models (e.g. qwen3); they slow every call and pollute summaries/JSON.
  // No timeout: CPU-only local inference can legitimately take minutes.
  const response = await post(provider.label, `${provider.baseUrl}/api/generate`, {}, {
    model: provider.model,
    prompt,
    stream: false,
    think: false,
    options,
    ...(opts.json ? { format: 'json' } : {}),
  });
  const data = (await response.json()) as { response?: string };
  if (typeof data.response !== 'string') {
    throw new LlmError(`${provider.label} returned an unexpected payload`);
  }
  return data.response.trim();
}

async function requestOpenAiCompatible(
  provider: OpenAiCompatibleProvider,
  prompt: string,
  opts: GenerateOptions,
  timeoutMs: number
): Promise<string> {
  if (!provider.apiKey) {
    throw new LlmError(`${provider.label} is not configured: set ${provider.apiKeyEnv}`);
  }
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  };
  if (provider.reasoningEffort) {
    body.reasoning_effort = provider.reasoningEffort;
  }
  if (opts.maxTokens) {
    body.max_tokens = opts.maxTokens + (provider.reasoningEffort ? THINKING_HEADROOM_TOKENS : 0);
  }
  if (opts.json) {
    body.response_format = { type: 'json_object' };
  }
  const response = await post(
    provider.label,
    `${provider.baseUrl}/chat/completions`,
    { Authorization: `Bearer ${provider.apiKey}` },
    body,
    timeoutMs
  );
  const data = (await response.json()) as { choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }> };
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string') {
    throw new LlmError(`${provider.label} returned an unexpected payload`);
  }
  if (opts.json && choice?.finish_reason === 'length') {
    throw new LlmError(`${provider.label} ran out of output tokens before finishing the JSON answer`);
  }
  return content.trim();
}

async function post(label: string, url: string, headers: Record<string, string>, body: unknown, timeoutMs?: number): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch (err: any) {
    throw new LlmError(`${label} is not reachable: ${err?.message || err}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new LlmError(`${label} request failed (${response.status}): ${text.slice(0, 500)}`, {
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs: retryAfterMs(response.headers.get('retry-after'), text),
    });
  }
  return response;
}

// Honour Retry-After, or Gemini's "retryDelay": "23s" in the error body.
function retryAfterMs(header: string | null, body: string): number | undefined {
  if (header?.trim()) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    const at = Date.parse(header);
    if (!Number.isNaN(at)) {
      return Math.max(0, at - Date.now());
    }
  }
  const match = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return match ? Number(match[1]) * 1000 : undefined;
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        // fall through
      }
    }
    throw new LlmError('Model did not return valid JSON');
  }
}

export function generateJson<T>(prompt: string, maxTokens = 512): Promise<T> {
  return generateAccepted(prompt, { json: true, maxTokens }, parseJson<T>);
}
