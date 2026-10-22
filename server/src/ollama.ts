export const DEFAULT_OLLAMA_MODEL = 'qwen3:8b';
export const DEFAULT_OLLAMA_NUM_CTX = 8192;
export const DEFAULT_OLLAMA_CONCURRENCY = 4;

const positiveInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function ollamaConfig() {
  return {
    baseUrl: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, ''),
    model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
    numCtx: positiveInt(process.env.OLLAMA_NUM_CTX, DEFAULT_OLLAMA_NUM_CTX),
    concurrency: positiveInt(process.env.OLLAMA_CONCURRENCY, DEFAULT_OLLAMA_CONCURRENCY),
  };
}

export class OllamaError extends Error {}

// Process-wide cap on in-flight requests so parallel callers queue here rather than time out inside Ollama's queue.
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

export async function generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  const { concurrency } = ollamaConfig();
  await acquireSlot(concurrency);
  try {
    return await requestGenerate(prompt, opts);
  } finally {
    releaseSlot();
  }
}

async function requestGenerate(prompt: string, opts: GenerateOptions): Promise<string> {
  const { baseUrl, model, numCtx } = ollamaConfig();
  const options: Record<string, number> = { num_ctx: numCtx };
  if (opts.maxTokens) {
    options.num_predict = opts.maxTokens;
  }
  let response: Response;
  try {
    // Disable reasoning traces on thinking models (e.g. qwen3); they slow every call and pollute summaries/JSON.
    response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, think: false, options, ...(opts.json ? { format: 'json' } : {}) }),
    });
  } catch (err: any) {
    throw new OllamaError(`Ollama is not reachable: ${err?.message || err}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new OllamaError(`Ollama request failed (${response.status}): ${body}`);
  }
  const data = (await response.json()) as { response?: string };
  if (typeof data.response !== 'string') {
    throw new OllamaError('Ollama returned an unexpected payload');
  }
  return data.response.trim();
}

export async function generateJson<T>(prompt: string, maxTokens = 512): Promise<T> {
  const text = await generate(prompt, { json: true, maxTokens });
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
    throw new OllamaError('Model did not return valid JSON');
  }
}
