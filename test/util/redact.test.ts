import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeEnv, envVarNames, redactCommandLine, redactText, redactValue, SECRET_SHAPED } from '../../src/util/redact';

/**
 * redact.ts is the only path by which env data and command lines reach the screen, so these
 * tests are about one thing: no value ever comes out, not even shortened.
 */

/**
 * Realistic strings that must never survive redaction. Shared with the sweep in
 * redactionSweep.test.ts, and each is also checked against SECRET_SHAPED so the fixtures
 * cannot silently stop being secret-shaped.
 */
export const SECRET_FIXTURES = [
  'PGPASSWORD=hunter2 psql -h db',
  'npx server --token=sk-live-abcdefghijklmn',
  'ghp_abcdefghijklmnopqrstuv',
  'xoxb-123456789012-abcdefghijkl',
  'export OPENAI_API_KEY=sk-proj-abcdefghijklmnop',
  'DATABASE_PASSWORD=p@ssword',
  '--secret=ocr_live_abcdefghijklmn',
  'API_TOKEN=abc123def456',
];

test('envVarNames returns [] for every non-object shape', () => {
  for (const input of [undefined, null, 'ENV', 42, ['A'], true]) {
    assert.deepEqual(envVarNames(input), []);
  }
});

test('envVarNames returns names sorted, and no values', () => {
  const env = { Z_KEY: 'secret-z', A_KEY: 'secret-a' };
  assert.deepEqual(envVarNames(env), ['A_KEY', 'Z_KEY']);
  const rendered = JSON.stringify(envVarNames(env));
  assert.ok(!rendered.includes('secret-z'));
  assert.ok(!rendered.includes('secret-a'));
});

test('describeEnv is undefined for an empty or non-object env', () => {
  assert.equal(describeEnv({}), undefined);
  assert.equal(describeEnv(undefined), undefined);
  assert.equal(describeEnv('nope'), undefined);
});

test('describeEnv counts in the singular and the plural', () => {
  assert.match(describeEnv({ A: '1' }) ?? '', /^1 environment variable: A /);
  assert.match(describeEnv({ A: '1', B: '2' }) ?? '', /^2 environment variables: A, B /);
});

test('describeEnv never contains a value', () => {
  const text = describeEnv({ API_KEY: 'sk-live-abcdefghijklmn', URL: 'https://example.com' }) ?? '';
  assert.ok(!text.includes('sk-live-abcdefghijklmn'));
  assert.ok(!text.includes('https://example.com'));
  assert.ok(text.endsWith('(values not shown)'));
});

test('redactCommandLine masks a KEY=value argument but keeps the name', () => {
  assert.equal(redactCommandLine(['PGPASSWORD=hunter2']), 'PGPASSWORD=••••••');
  assert.equal(redactCommandLine(['--token=abc123def456']), '--token=••••••');
});

test('redactCommandLine matches a secret name that follows other text', () => {
  // The source comment calls this out: `Bash(PGPASSWORD=… psql:*)` in a permission rule.
  assert.equal(redactCommandLine(['Bash(PGPASSWORD=hunter2']), 'Bash(PGPASSWORD=••••••');
  assert.equal(redactCommandLine(['X-Api-Key=abc123def456']), 'X-Api-Key=••••••');
});

test('redactCommandLine covers every documented name fragment, in any case', () => {
  for (const name of ['key', 'token', 'secret', 'password', 'passwd', 'pwd', 'credential']) {
    for (const cased of [name, name.toUpperCase(), name[0].toUpperCase() + name.slice(1)]) {
      assert.equal(redactCommandLine([`${cased}=abc123def456`]), `${cased}=••••••`, cased);
    }
  }
});

test('redactCommandLine leaves an empty value alone', () => {
  // The regex needs at least one character after `=`, so there is nothing to hide.
  assert.equal(redactCommandLine(['token=']), 'token=');
});

test('redactCommandLine masks a whole argument that looks like a credential', () => {
  for (const value of [
    'sk-abcdefghijklmnop',
    'pk_abcdefghijklmnop',
    'ghp_abcdefghijklmnop',
    'gho_abcdefghijklmnop',
    'xoxb-abcdefghijklmnop',
    'xoxp-abcdefghijklmnop',
    'ocr_live-abcdefghijklmn',
    'live_abcdefghijklmnop',
    'api-abcdefghijklmnop',
  ]) {
    assert.equal(redactCommandLine([value]), '••••••', value);
  }
});

test('redactCommandLine keeps a token-shaped word that is too short to be one', () => {
  // The rule is 12 characters after the prefix; 11 stays readable.
  assert.equal(redactCommandLine(['sk-abcdefghij']), 'sk-abcdefghij');
});

test('redactCommandLine leaves an ordinary command line byte-identical', () => {
  const line = 'npm run build -- --watch';
  assert.equal(redactCommandLine(line.split(' ')), line);
  // A variable reference is not a value.
  assert.equal(redactCommandLine(['echo', '$MY_TOKEN']), 'echo $MY_TOKEN');
});

test('redactValue stringifies null and undefined literally', () => {
  assert.equal(redactValue('model', null), 'null');
  assert.equal(redactValue('model', undefined), 'undefined');
});

test('redactValue never stringifies a container wholesale', () => {
  assert.equal(redactValue('env', { API_KEY: 'sk-live-abcdefghijklmn' }), '{…}');
  assert.equal(redactValue('allow', ['Bash(ls)']), '[…]');
});

test('redactValue passes non-string scalars through', () => {
  assert.equal(redactValue('cleanupPeriodDays', 30), '30');
  assert.equal(redactValue('enabled', true), 'true');
});

test('redactValue masks any value under a credential-shaped key', () => {
  for (const key of ['apiKey', 'AUTH_TOKEN', 'x-auth', 'dbPassword', 'credentials', 'mySecret']) {
    assert.equal(redactValue(key, 'opus'), '••••••', key);
  }
});

test('redactValue exempts a *Helper key but still redacts its command line', () => {
  // `apiKeyHelper` names a program to run, which is useful to see -- unlike a raw key.
  assert.equal(redactValue('apiKeyHelper', '/usr/bin/cred-helper'), '/usr/bin/cred-helper');
  assert.equal(redactValue('apiKeyHelper', '/bin/h --token=sk-live-abcdefghijklmn'), '/bin/h --token=••••••');
});

test('redactValue redacts a secret embedded in an otherwise ordinary value', () => {
  assert.equal(redactValue('statusLine', 'curl -H TOKEN=abc123def456'), 'curl -H TOKEN=••••••');
});

test('redactValue collapses runs of whitespace', () => {
  assert.equal(redactValue('statusLine', 'a\n\tb'), 'a b');
});

test('redactText preserves line count and order', () => {
  const out = redactText('one\ntwo\nthree');
  assert.equal(out.split('\n').length, 3);
  assert.equal(out, 'one\ntwo\nthree');
});

test('redactText masks per line and leaves the rest intact', () => {
  const out = redactText('Error: invalid token=abc123def456\nretrying');
  assert.equal(out, 'Error: invalid token=••••••\nretrying');
});

test('redactText returns the empty string unchanged', () => {
  assert.equal(redactText(''), '');
});

test('nothing in SECRET_FIXTURES survives any of the three redactors', () => {
  for (const raw of SECRET_FIXTURES) {
    assert.ok(SECRET_SHAPED.test(raw), `fixture is no longer secret-shaped: ${raw}`);
    assert.ok(!SECRET_SHAPED.test(redactCommandLine(raw.split(/\s+/))), `redactCommandLine leaked: ${raw}`);
    assert.ok(!SECRET_SHAPED.test(redactText(raw)), `redactText leaked: ${raw}`);
    assert.ok(!SECRET_SHAPED.test(redactValue('detail', raw)), `redactValue leaked: ${raw}`);
  }
});
