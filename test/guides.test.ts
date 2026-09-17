import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillPrompt, GUIDES, guideIssues, promptPreview, renderGuide, renderPrompt, templateKeys } from '../src/guides';
import { ASSET_ORDER } from '../src/discovery/types';

/**
 * What `npm run audit -- --guide all` checks, as tests that fail loudly instead of a CLI
 * nobody runs. Pure static data, so these need no fixture and cost nothing.
 */

test('every surface has a guide', () => {
  const missing = ASSET_ORDER.filter((kind) => !GUIDES[kind]);
  assert.deepEqual(missing, []);
});

for (const kind of ASSET_ORDER) {
  test(`the ${kind} guide is well formed`, () => {
    const guide = GUIDES[kind];
    assert.ok(guide, `no guide for ${kind}`);
    assert.deepEqual(guideIssues(guide), [], `guideIssues found problems in the ${kind} guide`);
  });
}

test('every prompt id is unique within its guide', () => {
  for (const [kind, guide] of Object.entries(GUIDES)) {
    const ids = guide.prompts.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${kind} repeats a prompt id`);
  }
});

test('every documentation link is https', () => {
  for (const [kind, guide] of Object.entries(GUIDES)) {
    for (const link of guide.links) {
      assert.match(link.url, /^https:\/\//, `${kind} has a non-https link`);
    }
    if (guide.docs) {
      assert.match(guide.docs, /^https:\/\//, `${kind}'s docs link is not https`);
    }
  }
});

test('a rendered guide leaves no placeholder unfilled', () => {
  for (const kind of ASSET_ORDER) {
    assert.ok(!renderGuide(kind).includes('{{'), `${kind}'s guide renders an unfilled {{…}}`);
  }
});

test('a prompt preview substitutes every field', () => {
  for (const [kind, guide] of Object.entries(GUIDES)) {
    for (const prompt of guide.prompts) {
      assert.ok(!promptPreview(prompt).includes('{{'), `${kind}/${prompt.id} leaves a field unfilled`);
    }
  }
});

test('templateKeys picks up plain keys and block markers alike', () => {
  assert.deepEqual([...templateKeys('a {{one}} b {{#two}}x{{/two}}')].sort(), ['one', 'two']);
});

test('fillPrompt substitutes a value and leaves an unknown key verbatim', () => {
  assert.equal(fillPrompt('Hello {{name}} and {{other}}', { name: 'world' }), 'Hello world and {{other}}');
});

test('fillPrompt keeps a block only when its key has a non-empty value', () => {
  const template = 'a{{#extra}} plus {{extra}}{{/extra}}b';
  assert.equal(fillPrompt(template, { extra: 'more' }), 'a plus moreb');
  assert.equal(fillPrompt(template, { extra: '   ' }), 'ab');
  assert.equal(fillPrompt(template, {}), 'ab');
});

test('a list line left empty by a removed block is dropped', () => {
  const template = '1. keep\n2. {{#gone}}removed{{/gone}}\n3. also keep';
  assert.ok(!fillPrompt(template, {}).includes('2. \n'));
});

test('renderPrompt renumbers a list after blocks were removed', () => {
  const prompt = {
    id: 't',
    label: 't',
    detail: 't',
    fields: [],
    template: '1. first\n{{#gone}}2. middle\n{{/gone}}3. third\n4. fourth',
  };
  const out = renderPrompt(prompt as never, {});
  assert.equal(out, '1. first\n2. third\n3. fourth');
});
