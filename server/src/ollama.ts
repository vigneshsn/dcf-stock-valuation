export const DEFAULT_OLLAMA_MODEL = 'qwen3:8b';

export function ollamaConfig() {
  return {
    baseUrl: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, ''),
    model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
  };
}

export class OllamaError extends Error {}

export async function generate(prompt: string, opts: { json?: boolean } = {}): Promise<string> {
  const { baseUrl, model } = ollamaConfig();
  let response: Response;
  try {
    // Disable reasoning traces on thinking models (e.g. qwen3); they slow every call and pollute summaries/JSON.
    response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, think: false, ...(opts.json ? { format: 'json' } : {}) }),
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

export async function generateJson<T>(prompt: string): Promise<T> {
  const text = await generate(prompt, { json: true });
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
