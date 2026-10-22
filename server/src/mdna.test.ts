import { test } from 'node:test';
import assert from 'node:assert';
import { chunkText, extractMdna, filterRelevant } from './mdna.js';

// Column-wrapped like real PDF text: short lines, no blank lines between paragraphs.
const wrap = (s: string) => s.replace(/(.{1,35})(\s|$)/g, '$1\n');
const MACRO = 'Global GDP growth slowed as inflation and tight monetary policy weighed on the world economy. ';
const ESG = 'Energy consumption at plants stood at 695,719 GJ and greenhouse emissions declined across sites. ';
const BUSINESS = 'We expect double digit volume growth next year and our market share in decorative paints rose to 52%. ';

test('filterRelevant keeps business and guidance passages and drops macro and ESG text', () => {
  const section = wrap(MACRO.repeat(30) + BUSINESS.repeat(30) + ESG.repeat(30) + '2019 2020 2021 2022 12.4 13.1 15.6 18.2 '.repeat(40));
  const out = filterRelevant(section);
  assert.ok(out.includes('our market share in decorative paints rose to 52%'));
  assert.ok(!out.includes('monetary policy'));
  assert.ok(!out.includes('greenhouse'));
  assert.ok(!out.includes('2019 2020 2021'));
  assert.ok(out.split('\n\n').every((p) => !p.includes('\n')), 'reflows column-wrapped lines');
});

test('filterRelevant caps output at maxChars, preferring the densest passages', () => {
  const filler = 'The Company opened stores and its revenue grew in line with plan. ';
  const section = wrap((filler.repeat(8) + BUSINESS.repeat(2)).repeat(40));
  const out = filterRelevant(section, 5000);
  assert.ok(out.length <= 5000);
  assert.ok(out.includes('We expect double digit volume growth'));
});

test('filterRelevant falls back to the raw section when almost nothing matches', () => {
  const section = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(100);
  assert.strictEqual(filterRelevant(section, 2000), section.slice(0, 2000));
});

test('extractMdna skips the table of contents and stops at next major section', () => {
  const body = 'Revenue grew strongly and we expect continued growth. '.repeat(60);
  const text = `Contents\nManagement Discussion and Analysis ..... 12\nDirectors' Report ..... 20\n\n` +
    `Management Discussion and Analysis\n${body}\nDirectors' Report\nunrelated text`;
  const section = extractMdna(text)!;
  assert.ok(section.startsWith('Management Discussion and Analysis\nRevenue'));
  assert.ok(!section.includes('unrelated'));
});

test('extractMdna returns null when absent', () => {
  assert.strictEqual(extractMdna('nothing relevant'), null);
});

test('chunkText bounds chunk size and keeps all text', () => {
  const text = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} ${'x'.repeat(300)}`).join('\n\n');
  const chunks = chunkText(text, 1000);
  assert.ok(chunks.every((c) => c.length <= 1000 + 400));
  assert.ok(chunks.length > 5);
  assert.ok(chunks.join('').includes('Paragraph 49'));
});
