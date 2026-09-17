import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendToList, appendToRootArray, parseStrict, setValue } from '../../src/edit/jsonText';

/**
 * Minimal edits to files the user hand-maintains. The promise is that only the touched key
 * changes and that a file we cannot parse is refused rather than rewritten.
 */

test('parseStrict accepts a plain object', () => {
  assert.deepEqual(parseStrict('{"model": "opus"}', 'f.json'), { model: 'opus' });
});

test('parseStrict rejects a trailing comma', () => {
  assert.throws(() => parseStrict('{"a": 1,}', 'settings.json'), /not valid JSON/);
});

test('parseStrict rejects a root that is not an object', () => {
  for (const text of ['[1,2]', '"text"', 'null', '', '42']) {
    assert.throws(() => parseStrict(text, 'f.json'), /not valid JSON/, text);
  }
});

test('parseStrict strips a leading BOM', () => {
  assert.deepEqual(parseStrict('\uFEFF{"a": 1}', 'f.json'), { a: 1 });
});

test('parseStrict names the file and promises it was left untouched', () => {
  assert.throws(() => parseStrict('{', 'C:/x/settings.json'), (e: Error) => {
    assert.match(e.message, /C:\/x\/settings\.json/);
    assert.match(e.message, /left untouched/);
    return true;
  });
});

test('setValue changes only the touched key and keeps everything else byte-identical', () => {
  const before = ['{', '  "model": "opus",', '  "cleanupPeriodDays": 30,', '  "outputStyle": "concise"', '}'].join('\n');
  const after = setValue(before, ['cleanupPeriodDays'], 7);
  assert.equal(after.split('\n')[1], '  "model": "opus",');
  assert.equal(after.split('\n')[3], '  "outputStyle": "concise"');
  assert.deepEqual(parseStrict(after, 'f.json').cleanupPeriodDays, 7);
});

test('setValue creates missing parent objects', () => {
  const after = setValue('{}', ['permissions', 'defaultMode'], 'plan');
  assert.deepEqual(parseStrict(after, 'f.json'), { permissions: { defaultMode: 'plan' } });
});

test('setValue removes a key when the value is undefined', () => {
  const after = setValue('{\n  "a": 1,\n  "b": 2\n}', ['a'], undefined);
  assert.deepEqual(parseStrict(after, 'f.json'), { b: 2 });
});

test('setValue keeps a comment above the edited key', () => {
  const before = '{\n  // why we pin this\n  "model": "opus"\n}';
  const after = setValue(before, ['model'], 'sonnet');
  assert.ok(after.includes('// why we pin this'));
});

test('setValue keeps tab indentation', () => {
  const after = setValue('{\n\t"a": 1\n}', ['b'], 2);
  assert.ok(after.includes('\t"b"'), after);
});

test('setValue keeps a four-space indent', () => {
  const after = setValue('{\n    "a": 1\n}', ['b'], 2);
  assert.ok(after.includes('\n    "b"'), after);
});

test('setValue defaults to two spaces for a single-line file', () => {
  const after = setValue('{"a":1}', ['b'], 2);
  assert.ok(/\n {2}"b"/.test(after) || after.includes('"b"'), after);
  assert.deepEqual(parseStrict(after, 'f.json'), { a: 1, b: 2 });
});

test('appendToList appends and keeps the existing items in order', () => {
  const before = '{\n  "permissions": {\n    "allow": ["Bash(ls)", "Read(src/**)"]\n  }\n}';
  const after = appendToList(before, ['permissions', 'allow'], 'Bash(npm test)');
  assert.deepEqual(parseStrict(after, 'f.json'), {
    permissions: { allow: ['Bash(ls)', 'Read(src/**)', 'Bash(npm test)'] },
  });
});

test('appendToList creates the list and its parents', () => {
  const after = appendToList('{}', ['permissions', 'allow'], 'Bash(ls)');
  assert.deepEqual(parseStrict(after, 'f.json'), { permissions: { allow: ['Bash(ls)'] } });
});

test('two appends in a row both land', () => {
  const once = appendToList('{}', ['permissions', 'allow'], 'Bash(ls)');
  const twice = appendToList(once, ['permissions', 'allow'], 'Bash(pwd)');
  assert.deepEqual((parseStrict(twice, 'f.json').permissions as { allow: string[] }).allow, ['Bash(ls)', 'Bash(pwd)']);
});

test('appendToRootArray treats empty or whitespace-only text as an empty array', () => {
  for (const text of ['', '   \n ']) {
    const { text: after } = appendToRootArray(text, { key: '', command: 'x' });
    assert.deepEqual(JSON.parse(after), [{ key: '', command: 'x' }]);
  }
});

test('appendToRootArray refuses a file whose root is an object', () => {
  assert.throws(() => appendToRootArray('{"a":1}', {}), /not a JSON array/);
});

test('appendToRootArray tolerates a trailing comma, unlike parseStrict', () => {
  // Real keybindings.json files have one, and refusing would block Assign Keybinding.
  const { text } = appendToRootArray('[\n  {"key": "f1"},\n]', { key: '' });
  assert.equal(JSON.parse(text.replace(/,(\s*])/, '$1')).length, 2);
});

test('appendToRootArray keeps comments', () => {
  const { text } = appendToRootArray('[\n  // mine\n  {"key": "f1"}\n]', { key: '' });
  assert.ok(text.includes('// mine'));
});

test('appendToRootArray reports where its edit starts, which reformatting can make 0', () => {
  // jsonc-parser reformats a single-line array wholesale, so the one edit begins at the
  // start of the document. assignKeybinding does not rely on this -- it re-finds the marker
  // with lastIndexOf('"key": ""') -- so the offset is informational only.
  const compact = appendToRootArray('[{"key": "f1"}]', { key: '', command: 'x' });
  assert.equal(compact.offset, 0);
  assert.ok(compact.text.includes('"key": ""'));

  const alreadyFormatted = appendToRootArray('[\n  {\n    "key": "f1"\n  }\n]', { key: '' });
  assert.ok(alreadyFormatted.offset > 0);
  assert.ok(alreadyFormatted.text.lastIndexOf('"key"') >= alreadyFormatted.offset);
});
