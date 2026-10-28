import { test } from 'node:test';
import assert from 'node:assert';
import { verifiedQuote } from './quotes.js';

test('verifiedQuote accepts only verbatim text', () => {
  assert.strictEqual(verifiedQuote('strong  brand', 'We have a Strong brand in India'), 'strong  brand');
  assert.strictEqual(verifiedQuote('invented claim here', 'We have a strong brand'), null);
  assert.strictEqual(verifiedQuote('short', 'short'), null);
});

test('verifiedQuote accepts passages joined with an ellipsis only when every part is verbatim and in order', () => {
  const source = 'Revenue grew 4.6% in FY 2026 on steady demand. Later in the year, EBIT margins reached 25.0% in FY 2026.';
  assert.ok(verifiedQuote('Revenue grew 4.6% in FY 2026... EBIT margins reached 25.0%', source));
  assert.ok(verifiedQuote('Revenue grew 4.6% in FY 2026 … EBIT margins reached 25.0%', source));
  assert.strictEqual(verifiedQuote('EBIT margins reached 25.0%... Revenue grew 4.6% in FY 2026', source), null);
  assert.strictEqual(verifiedQuote('Revenue grew 4.6% in FY 2026... margins doubled overnight', source), null);
  assert.strictEqual(verifiedQuote('Revenue grew 4.6% in FY 2026... FY', source), null);
});
