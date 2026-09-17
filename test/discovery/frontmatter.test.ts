import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  asText,
  firstMeaningfulLine,
  parseFrontmatter,
  rawFrontmatterLine,
  toolList,
} from '../../src/discovery/frontmatter';

/**
 * A hand-written YAML subset, deliberately not a YAML library. Every shape below was found
 * on a real machine. The hard rule is that malformed input degrades -- it never throws,
 * because one bad skill file must not empty the whole tree.
 */

test('a file with no frontmatter is body only', () => {
  const doc = parseFrontmatter('Just prose.\n');
  assert.equal(doc.hasFrontmatter, false);
  assert.deepEqual(doc.data, {});
  assert.equal(doc.body, 'Just prose.\n');
});

test('an opening fence that is never closed is treated as body', () => {
  const doc = parseFrontmatter('---\nname: x\n\nstill going');
  assert.equal(doc.hasFrontmatter, false);
  assert.ok(doc.body.startsWith('---'));
});

test('CRLF and a BOM are normalised away', () => {
  const doc = parseFrontmatter('\uFEFF---\r\nname: deploy\r\n---\r\n\r\nBody\r\n');
  assert.equal(doc.hasFrontmatter, true);
  assert.equal(doc.data.name, 'deploy');
  assert.equal(doc.body, 'Body\n');
});

test('a quoted value may contain a colon', () => {
  const doc = parseFrontmatter(`---\ndescription: "Triggers on: 'x', 'y'"\n---\n`);
  assert.equal(doc.data.description, `Triggers on: 'x', 'y'`);
});

test('tools accepts a comma string, a JSON array and a bare bracket list', () => {
  assert.equal(parseFrontmatter('---\ntools: Read, Grep\n---\n').data.tools, 'Read, Grep');
  assert.deepEqual(parseFrontmatter('---\ntools: ["Read", "Grep"]\n---\n').data.tools, ['Read', 'Grep']);
  assert.deepEqual(parseFrontmatter('---\ntools: [Read, Grep]\n---\n').data.tools, ['Read', 'Grep']);
});

test('a block scalar keeps its newlines and is dedented by the smallest indent', () => {
  const text = [
    '---',
    'description: |',
    '  Use this agent when...',
    '  <example>',
    '  user: "do the thing"',
    '  </example>',
    '---',
    '',
    'Body',
  ].join('\n');
  const doc = parseFrontmatter(text);
  assert.equal(
    doc.data.description,
    'Use this agent when...\n<example>\nuser: "do the thing"\n</example>',
  );
  assert.equal(doc.body, 'Body');
});

test('every block scalar marker is recognised', () => {
  for (const marker of ['|', '>', '|-', '|+', '>-']) {
    const doc = parseFrontmatter(`---\ndescription: ${marker}\n  line one\n  line two\n---\n`);
    assert.equal(doc.data.description, 'line one\nline two', marker);
  }
});

test('a dash list under a bare key becomes an array with quotes stripped', () => {
  const doc = parseFrontmatter('---\npaths:\n  - "src/**"\n  - test/**\n---\n');
  assert.deepEqual(doc.data.paths, ['src/**', 'test/**']);
});

test('a bare key with indented prose below is folded to one line', () => {
  const doc = parseFrontmatter('---\ndescription:\n  first part\n  second part\n---\n');
  assert.equal(doc.data.description, 'first part second part');
});

test('a bare key with an indented nested map stays empty, as nesting is unsupported', () => {
  const doc = parseFrontmatter('---\nmeta:\n  nested: value\n---\n');
  assert.equal(doc.data.meta, '');
});

test('a bare key at the end of the block stays empty', () => {
  const doc = parseFrontmatter('---\ndescription:\n---\n');
  assert.equal(doc.data.description, '');
});

test('a line that is not key: value is skipped rather than fatal', () => {
  const doc = parseFrontmatter('---\nname: x\nthis is not yaml\ndescription: y\n---\n');
  assert.equal(doc.data.name, 'x');
  assert.equal(doc.data.description, 'y');
});

test('a duplicate key takes the last value', () => {
  assert.equal(parseFrontmatter('---\nname: first\nname: second\n---\n').data.name, 'second');
});

test('the body excludes the frontmatter and any leading blank lines', () => {
  assert.equal(parseFrontmatter('---\nname: x\n---\n\n\n# Title\n').body, '# Title\n');
});

test('parseFrontmatter never throws, whatever it is given', () => {
  const hostile = [
    '',
    '---',
    '---\n---',
    '---\n:\n---',
    '---\nkey:\n  - \n---',
    '---\n\t\tname: x\n---',
    '---\nname: "unterminated\n---',
    'a'.repeat(200_000),
    '\r',
    '---\n\u0000\n---',
    '---\n' + '- '.repeat(5000) + '\n---',
  ];
  for (const text of hostile) {
    assert.doesNotThrow(() => parseFrontmatter(text), JSON.stringify(text.slice(0, 40)));
  }
});

test('toolList normalises both syntaxes and drops empties', () => {
  assert.deepEqual(toolList('Read, Grep , '), ['Read', 'Grep']);
  assert.deepEqual(toolList(['Read', ' Grep ']), ['Read', 'Grep']);
  assert.deepEqual(toolList(undefined), []);
});

test('asText joins an array, collapses whitespace, and is undefined when empty', () => {
  assert.equal(asText(['a', 'b']), 'a, b');
  assert.equal(asText('a \n  b'), 'a b');
  assert.equal(asText('   '), undefined);
  assert.equal(asText(undefined), undefined);
});

test('firstMeaningfulLine skips blanks, headings and fences', () => {
  assert.equal(firstMeaningfulLine('\n# Title\n---\nThe real line\n'), 'The real line');
  assert.equal(firstMeaningfulLine('\n\n'), undefined);
});

test('rawFrontmatterLine returns the line literally, not parsed as a list', () => {
  // argument-hint drives the Run input box; `[issue] [format]` is meant literally.
  const text = '---\nargument-hint: [issue] [format]\n---\n';
  assert.equal(rawFrontmatterLine(text, 'argument-hint'), '[issue] [format]');
  assert.deepEqual(parseFrontmatter(text).data['argument-hint'], ['issue] [format']);
});

test('rawFrontmatterLine is undefined when absent, empty, or there is no frontmatter', () => {
  assert.equal(rawFrontmatterLine('---\nname: x\n---\n', 'argument-hint'), undefined);
  assert.equal(rawFrontmatterLine('---\nargument-hint:\n---\n', 'argument-hint'), undefined);
  assert.equal(rawFrontmatterLine('no frontmatter\n', 'argument-hint'), undefined);
});
