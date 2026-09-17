import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { sendToActiveSession } from '../../src/commands/runActions';
import { FakeTerminal, reset, stub } from '../stubs/vscode';
import { fakeContext } from '../helpers/context';

/**
 * Typing into a session that is already running. There is no API that says where Claude Code
 * runs, so the picking order and the confirmation gate are the whole safety story.
 */

const CONFIRMED = { 'claudeExplorer.sessionWriteConfirmed': true };

/** A terminal the user opened themselves, which the extension did not create. */
function open(name: string): FakeTerminal {
  const terminal = new FakeTerminal(name);
  stub.terminals.push(terminal);
  return terminal;
}

beforeEach(() => reset());

test('types into the focused terminal when it looks like a Claude session', async () => {
  reset({ config: CONFIRMED });
  open('bash');
  const claude = open('Claude: /deploy');
  stub.activeTerminal = claude;

  const sent = await sendToActiveSession(fakeContext(CONFIRMED), '/deploy', { submit: false, title: '/deploy' });

  assert.equal(sent, true);
  assert.deepEqual(claude.sent, [{ text: '/deploy ', enter: false }]);
  assert.equal(claude.shown, 1, 'the terminal should be focused so the user can keep typing');
});

test('insert appends exactly one trailing space, submit appends none', async () => {
  reset({ config: CONFIRMED });
  const claude = open('claude');
  stub.activeTerminal = claude;
  const context = fakeContext(CONFIRMED);

  await sendToActiveSession(context, '/a', { submit: false, title: '/a' });
  await sendToActiveSession(context, '/b', { submit: true, title: '/b' });

  assert.deepEqual(claude.sent, [
    { text: '/a ', enter: false },
    { text: '/b', enter: true },
  ]);
});

test('a multi-line prompt is folded, because a newline would submit it early', async () => {
  const claude = open('claude');
  stub.activeTerminal = claude;

  await sendToActiveSession(fakeContext(CONFIRMED), 'first line\n\nsecond line', { submit: true, title: 't' });

  assert.deepEqual(claude.sent, [{ text: 'first line second line', enter: true }]);
});

test('whitespace-only text sends nothing', async () => {
  const claude = open('claude');
  stub.activeTerminal = claude;

  assert.equal(await sendToActiveSession(fakeContext(CONFIRMED), '   \n ', { submit: true, title: 't' }), false);
  assert.deepEqual(claude.sent, []);
});

test('the first write asks, naming the terminal and quoting the text', async () => {
  const claude = open('Claude: /x');
  stub.activeTerminal = claude;
  stub.answers = ['Type'];

  const sent = await sendToActiveSession(fakeContext(), '/deploy', { submit: false, title: '/deploy' });

  assert.equal(sent, true);
  assert.equal(stub.shown.length, 1);
  assert.match(stub.shown[0].message, /Claude: \/x/);
  assert.ok(stub.shown[0].modal, 'the first write should be a modal, not a toast');
  assert.deepEqual(stub.shown[0].items, ['Type', 'Type and Don’t Ask Again']);
});

test('declining the confirmation sends nothing', async () => {
  const claude = open('claude');
  stub.activeTerminal = claude;
  stub.answers = [undefined];

  assert.equal(await sendToActiveSession(fakeContext(), '/deploy', { submit: false, title: 't' }), false);
  assert.deepEqual(claude.sent, []);
});

test('"Don’t Ask Again" is remembered, so the second write is silent', async () => {
  const claude = open('claude');
  stub.activeTerminal = claude;
  stub.answers = ['Type and Don’t Ask Again'];
  const context = fakeContext();

  await sendToActiveSession(context, '/a', { submit: false, title: 'a' });
  await sendToActiveSession(context, '/b', { submit: false, title: 'b' });

  assert.equal(stub.shown.length, 1, 'only the first write should ask');
  assert.equal(claude.sent.length, 2);
});

test('a terminal named claude is preferred even when another one is focused', async () => {
  const shell = open('powershell');
  const claude = open('claude');
  stub.activeTerminal = shell;

  await sendToActiveSession(fakeContext(CONFIRMED), '/x', { submit: true, title: 'x' });

  assert.deepEqual(shell.sent, []);
  assert.equal(claude.sent.length, 1);
});

test('with only unrecognisable terminals open, the user is asked which one', async () => {
  const shell = open('bash');
  open('zsh');
  stub.picks = [(offered: readonly unknown[]) => (offered as Array<{ terminal?: FakeTerminal }>)[0]];

  await sendToActiveSession(fakeContext(CONFIRMED), '/x', { submit: true, title: 'x' });

  assert.deepEqual(shell.sent, [{ text: '/x', enter: true }]);
});

test('cancelling that question sends nothing and starts nothing', async () => {
  open('bash');
  stub.picks = [undefined];

  assert.equal(await sendToActiveSession(fakeContext(CONFIRMED), '/x', { submit: true, title: 'x' }), false);
  assert.equal(stub.terminals.length, 1);
  assert.deepEqual(stub.terminals[0].sent, []);
});

test('with no terminal open at all, a submit starts a new session', async () => {
  stub.answers = ['Run and Don’t Ask Again'];

  const sent = await sendToActiveSession(fakeContext(), '/deploy', { submit: true, title: '/deploy' });

  assert.equal(sent, true);
  assert.equal(stub.terminals.length, 1);
  assert.deepEqual(stub.terminals[0].sent, [{ text: `claude '/deploy'`, enter: true }]);
});

test('with no session, an insert asks rather than quietly running it', async () => {
  // Starting a session means `claude '<text>'`, which submits at once -- the opposite of
  // what the insert button promises, so it must not happen silently.
  stub.answers = ['Copy the Text'];

  const sent = await sendToActiveSession(fakeContext(CONFIRMED), '/deploy', { submit: false, title: '/deploy' });

  assert.equal(sent, false);
  assert.equal(stub.terminals.length, 0, 'nothing should have been started');
  assert.deepEqual(stub.clipboard, ['/deploy']);
  assert.match(stub.shown[0].message, /No running Claude Code session/);
});

test('dismissing that question does nothing at all', async () => {
  stub.answers = [undefined];

  assert.equal(await sendToActiveSession(fakeContext(CONFIRMED), '/x', { submit: false, title: 'x' }), false);
  assert.equal(stub.terminals.length, 0);
  assert.deepEqual(stub.clipboard, []);
});

test('the terminal used is remembered, so a later insert does not ask again', async () => {
  const first = open('claude');
  const second = open('claude-other');
  stub.activeTerminal = first;
  const context = fakeContext(CONFIRMED);

  await sendToActiveSession(context, '/a', { submit: true, title: 'a' });
  // Focus moves elsewhere; the remembered session should still win.
  stub.activeTerminal = undefined;
  await sendToActiveSession(context, '/b', { submit: true, title: 'b' });

  assert.equal(first.sent.length, 2);
  assert.deepEqual(second.sent, []);
});
