import { test } from 'node:test';
import assert from 'node:assert';
import { qualitativeScore, selectPeers, verifiedQuote, Peer } from './qualitative.js';

const p = (symbol: string, marketCap: number | null): Peer => ({ symbol, name: symbol, marketCap });

test('selectPeers: nearest 5 by market cap, excludes target and duplicates', () => {
  const target = p('T', 1000);
  const peers = selectPeers(target, [p('A', 100), p('B', 900), p('C', 1100), p('T', 1000), p('B', 900), p('D', 1300), p('E', 5000), p('F', 990), p('G', null)]);
  assert.deepStrictEqual(peers.map((x) => x.symbol), ['F', 'B', 'C', 'D', 'A']);
});

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

test('qualitativeScore: combines moat and management, labelled experimental', () => {
  const r = qualitativeScore(
    { rating: 'wide', reasoning: 'r', quote: 'strong brand power' },
    { comparisons: [{ guidanceYear: 2022, actualsYear: 2023, outcome: 'met', reasoning: 'x', quote: null }, { guidanceYear: 2023, actualsYear: 2024, outcome: 'missed', reasoning: 'y', quote: null }], lowerConfidence: false }
  );
  assert.strictEqual(r.score, 4); // (5 + 3) / 2
  assert.strictEqual(r.experimental, true);
  assert.match(r.explanation, /"strong brand power"/);
});

test('qualitativeScore: flags lower confidence and handles no comparisons', () => {
  const r = qualitativeScore({ rating: 'none', reasoning: '', quote: null }, { comparisons: [], lowerConfidence: true });
  assert.strictEqual(r.score, 1);
  assert.match(r.explanation, /Lower confidence/);
});
