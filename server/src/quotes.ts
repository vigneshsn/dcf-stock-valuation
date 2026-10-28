const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

// Keep a quote only if it appears verbatim in the report text we gave the model.
// Models often join two passages with "..."; then every part must appear verbatim, in order.
export function verifiedQuote(quote: unknown, source: string): string | null {
  if (typeof quote !== 'string' || quote.trim().length < 8) {
    return null;
  }
  const parts = norm(quote).split(/\s*(?:\.{3}|…)\s*/).filter(Boolean);
  if (!parts.length || parts.some((p) => p.length < 8)) {
    return null;
  }
  const text = norm(source);
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    if (at < 0) {
      return null;
    }
    from = at + part.length;
  }
  return quote.trim();
}
