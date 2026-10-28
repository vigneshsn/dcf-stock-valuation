import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractOutlookSections, isHeading } from './reportSections.js';

test('isHeading: matches heading lines but not wrapped body text', () => {
  const ot = /opportunities\s+(?:and|&)\s+(?:threats|challenges)/;
  assert.ok(isHeading('Opportunities and Threats', ot));
  assert.ok(isHeading('3.2 OPPORTUNITIES & CHALLENGES:', ot));
  assert.ok(isHeading('Opportunities and Threats for the Indian IT Industry', ot));
  assert.ok(!isHeading('opportunities and threats in the market remain balanced as', ot));
  assert.ok(!isHeading('see Opportunities and Threats', ot));
  assert.ok(!isHeading('Opportunities and Threats 14', ot));
  assert.ok(isHeading('Opportunities and threats for our business', ot, 'The market grew.'));
  assert.ok(!isHeading('Opportunities and threats for our business', ot, 'are discussed below.'));
});

test('extractOutlookSections: recognises integrated-report risk headings', () => {
  const text = ['Critical risks and mitigation strategies', 'Counterfeit products pose a serious threat to brand equity.', filler('risk')].join('\n');
  assert.match(extractOutlookSections(text).risks!, /^Critical risks/);
  assert.match(extractOutlookSections(text.replace('Critical risks and mitigation strategies', 'Risks and Opportunities')).opportunitiesAndThreats!, /^Risks and Opportunities/);
});

const filler = (topic: string) => Array.from({ length: 12 }, (_, i) => `The company sees ${topic} number ${i} in its markets this year.`).join('\n');

const report = [
  'Contents',
  'Management Discussion and Analysis 12',
  'Opportunities and Threats 14',
  'Directors Report 30',
  'Management Discussion and Analysis',
  'Our market share in premium segment rose to a record level this year.',
  filler('competitive strength'),
  'Opportunities and Threats',
  'Rising rural demand offers a large growth runway for our products.',
  filler('opportunity'),
  'Outlook',
  'We expect steady growth next year.',
  filler('outlook item'),
  'Risks and Concerns',
  'Volatile raw material prices could compress margins significantly.',
  filler('risk'),
  'Internal Control Systems',
  filler('control item'),
  'Directors Report',
  'Board matters.',
].join('\n');

test('extractOutlookSections: finds the body sections, not table-of-contents hits', () => {
  const s = extractOutlookSections(report);
  assert.match(s.opportunitiesAndThreats!, /^Opportunities and Threats\nRising rural demand/);
  assert.doesNotMatch(s.opportunitiesAndThreats!, /We expect steady growth/);
  assert.match(s.risks!, /^Risks and Concerns\nVolatile raw material/);
  assert.doesNotMatch(s.risks!, /control item/);
});
