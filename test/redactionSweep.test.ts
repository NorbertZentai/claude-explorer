import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collect } from '../src/discovery';
import { effectiveSettings } from '../src/analysis/effectiveSettings';
import { hookTimeline } from '../src/analysis/hookTimeline';
import { securityReport } from '../src/analysis/security';
import { renderReport } from '../src/analysis/report';
import { agentMentionText, promptsFor } from '../src/prompts';
import { buildAddCommand } from '../src/mcp/addCommand';
import { readServer } from '../src/mcp/definition';
import { SECRET_SHAPED } from '../src/util/redact';
import { useFixture } from './helpers/fixture';

/**
 * The promise in the README: "env values and header values never enter an Asset or any
 * rendered string". The audit checks this against whatever happens to be on the developer's
 * machine; this plants known credentials in a fixture and proves they do not come back.
 */

/** Planted values. None of these may appear in anything rendered, in any form. */
const PLANTED = {
  mcpEnv: 'sk-live-abcdefghijklmnopqr',
  mcpEnv2: 'ghp_abcdefghijklmnopqrst',
  header: 'Bearer xoxb-123456789012-abcdefghijkl',
  settingsKey: 'sk-proj-abcdefghijklmnopqr',
  hookToken: 'ocr_live-abcdefghijklmnop',
  rulePassword: 'hunter2correcthorse',
};


function buildFixture(t: Parameters<typeof useFixture>[0]) {
  return useFixture(t, {
    '.claude': {
      'settings.json': JSON.stringify(
        {
          model: 'opus',
          apiKey: PLANTED.settingsKey,
          apiKeyHelper: `/bin/helper --token=${PLANTED.hookToken}`,
          permissions: {
            allow: [`Bash(PGPASSWORD=${PLANTED.rulePassword} psql:*)`, 'Bash(npm test)'],
            deny: ['Read(./.env)'],
          },
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: `/bin/notify --token=${PLANTED.hookToken}` }],
              },
            ],
          },
        },
        null,
        2,
      ),
      skills: {
        deploy: { 'SKILL.md': '---\nname: deploy\ndescription: Ship the app.\n---\n\nBody.\n' },
      },
      agents: { reviewer: '' },
    },
    proj: {
      '.mcp.json': JSON.stringify(
        {
          mcpServers: {
            local: {
              command: 'npx',
              args: ['-y', 'server', `--api-key=${PLANTED.mcpEnv}`],
              env: { API_KEY: PLANTED.mcpEnv, GITHUB_TOKEN: PLANTED.mcpEnv2 },
            },
            remote: {
              type: 'http',
              url: 'https://example.com/mcp',
              headers: { Authorization: PLANTED.header },
            },
          },
        },
        null,
        2,
      ),
      '.claude': {
        'settings.local.json': JSON.stringify({ enabledMcpjsonServers: ['local', 'remote'] }, null, 2),
      },
      'CLAUDE.md': '# Project\n\nNotes.\n',
    },
  });
}

test('no planted credential reaches any rendered string', (t) => {
  const fx = buildFixture(t);
  const projectRoot = fx.path('proj');
  const { assets, scopes } = collect({
    workspaceFolders: [projectRoot],
    extraProjectPaths: [],
    showPluginProvided: true,
    showPlaceholders: true,
  });

  // Labelled, so a failure names the surface that leaked without printing the secret.
  const rendered: Array<{ source: string; text: string }> = [];
  const push = (source: string, ...texts: Array<string | undefined>): void => {
    for (const text of texts) {
      if (text) {
        rendered.push({ source, text });
      }
    }
  };

  for (const a of assets) {
    const where = `asset ${a.kind}/${a.name}`;
    push(`${where} fields`, a.name, a.description, a.problem, a.overriddenBy?.reason);
    push(`${where} detail`, ...Object.values(a.detail ?? {}));
    if (!a.placeholder) {
      for (const prompt of promptsFor(a, { ref: `@${a.sourcePath}` })) {
        push(`${where} prompt "${prompt.label}"`, prompt.text);
      }
    }
    if (a.kind === 'agent') {
      push(`${where} mention`, agentMentionText(a));
    }
  }

  const settings = effectiveSettings(projectRoot);
  for (const entry of settings.entries) {
    push(`effective settings ${entry.keyPath}`, entry.keyPath, entry.value, entry.note);
  }
  push('effective settings notes', ...settings.notes);

  for (const event of hookTimeline(assets, projectRoot)) {
    for (const hook of event.hooks) {
      push(`hook timeline ${event.name}`, hook.command);
    }
  }

  const security = securityReport(assets, settings, projectRoot);
  for (const finding of security.findings) {
    push('security finding', finding.title, finding.detail);
  }
  for (const rule of security.rules) {
    push('security rule', rule.rule, rule.sourceLabel);
  }

  push('report (workspace)', renderReport(assets, scopes, { kind: 'workspace', root: projectRoot }, new Date(0)));
  push('report (user)', renderReport(assets, scopes, { kind: 'user' }, new Date(0)));

  for (const name of ['local', 'remote']) {
    const server = readServer(fx.path('proj', '.mcp.json'), name);
    if (server) {
      push(`claude mcp add ${name}`, buildAddCommand(name, server, true));
    }
  }

  // The strong assertion the audit does not make: the literal value, in any shape. The
  // failure names the surface that leaked rather than printing the credential.
  for (const [label, value] of Object.entries(PLANTED)) {
    const leaks = [...new Set(rendered.filter((r) => r.text.includes(value)).map((r) => r.source))];
    assert.deepEqual(leaks, [], `the planted ${label} was rendered by: ${leaks.join(', ')}`);
  }

  // And the audit's own gate, which also catches credentials we did not plant.
  const shaped = [...new Set(rendered.filter((r) => SECRET_SHAPED.test(r.text)).map((r) => r.source))];
  assert.deepEqual(shaped, [], `these rendered something secret-shaped: ${shaped.join(', ')}`);
});

test('an MCP server contributes variable names but never their values', (t) => {
  const fx = buildFixture(t);
  const { assets } = collect({
    workspaceFolders: [fx.path('proj')],
    extraProjectPaths: [],
    showPluginProvided: false,
    showPlaceholders: false,
  });
  const local = assets.find((a) => a.kind === 'mcp' && a.name === 'local');
  assert.ok(local, 'the fixture MCP server was not discovered');
  const detail = Object.values(local.detail ?? {}).join(' ');
  assert.ok(detail.includes('API_KEY'), 'the variable name should be shown');
  assert.ok(detail.includes('GITHUB_TOKEN'));
  assert.ok(!detail.includes(PLANTED.mcpEnv), 'the value must never be shown');
});
