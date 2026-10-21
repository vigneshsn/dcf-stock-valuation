import { test } from 'node:test';
import assert from 'node:assert';
import { chunkText, extractMdna } from './mdna.js';

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
