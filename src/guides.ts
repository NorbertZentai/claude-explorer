import { AssetKind, ASSET_LABELS } from './discovery/types';
import { framePrompt } from './promptFrame';

/**
 * A guide per surface: what it is, where it lives, when it earns its place, how to start,
 * a real example, the commands and settings around it, what goes wrong, prompts that set one
 * up, and where to get more. Facts follow code.claude.com/docs; every link was checked when
 * it was added.
 *
 * Prompts are templates. `{{key}}` is filled from a field the user is asked for;
 * `{{#key}}…{{/key}}` is kept only when that field has a value. `{{scopeLabel}}` and
 * `{{surfaceDir}}` are filled from where the guide was opened and never asked for.
 */

export interface GuideLink {
  label: string;
  url: string;
  kind: 'download' | 'catalog' | 'docs' | 'reference';
}

export interface GuideExample {
  title: string;
  path?: string;
  language: string;
  code: string;
  note?: string;
}

export interface PromptChoice {
  label: string;
  value: string;
  detail?: string;
}

export interface PromptField {
  key: string;
  /** Asked as a question: "Which formatter command?" */
  label: string;
  placeholder?: string;
  default?: string;
  choices?: PromptChoice[];
  optional?: boolean;
}

export interface GuidePrompt {
  id: string;
  label: string;
  detail: string;
  fields: PromptField[];
  template: string;
}

export interface Guide {
  title: string;
  /** One line under the title. */
  summary: string;
  what: string;
  where: string[];
  use: string[];
  avoid?: string[];
  /** Getting started, in order. */
  workflow?: string[];
  examples?: GuideExample[];
  /** [command, what it does] */
  commands?: Array<[string, string]>;
  /** [key, what it does] */
  settings?: Array<[string, string]>;
  gotchas?: string[];
  /** [symptom, what to do] */
  troubleshooting?: Array<[string, string]>;
  prompts: GuidePrompt[];
  links: GuideLink[];
  related?: AssetKind[];
  docs: string;
}

/** Filled from context by the Setup Prompt wizard, never asked for. */
export const AUTO_PROMPT_KEYS = new Set(['scopeLabel', 'surfaceDir']);

const D = 'https://code.claude.com/docs/en';

const doc = (label: string, page: string): GuideLink => ({ label, url: `${D}/${page}`, kind: 'docs' });

const SCOPE_FIELD: PromptField = {
  key: 'scope',
  label: 'Where should it live?',
  choices: [
    { label: 'User', value: 'user level (~/.claude), so it works in every project', detail: 'Personal, every project' },
    { label: 'Project', value: 'project level (.claude/ in this repository), so the team gets it through git', detail: 'Shared with the team' },
  ],
};

export const GUIDES: Record<AssetKind, Guide> = {
  skill: {
    title: 'Skills',
    summary: 'Reusable procedures Claude loads when they are relevant, or that you run as /name.',
    what: 'A folder with a `SKILL.md` that teaches Claude a procedure: how your team reviews code, cuts a release or writes a migration. Claude sees each skill\'s name and description at startup and loads the full file only when your request matches, so a skill costs little context until it is used. You can also invoke any skill yourself as `/name`, with arguments.',
    where: [
      '`~/.claude/skills/<name>/SKILL.md`: personal, every project',
      '`.claude/skills/<name>/SKILL.md`: this project, shared through git',
      '`<subdir>/.claude/skills/`: nested skills, loaded when Claude works in that folder',
      'Plugins: `<plugin>/skills/<name>/SKILL.md`, invoked as `/plugin:name`',
      'The **folder name** is the command you type; the frontmatter `name` is only a display label.',
    ],
    use: [
      'Use when you would otherwise paste the same instructions into conversation after conversation.',
      'The `description` decides when Claude loads it: lead with what it does, then "Use when …" with concrete situations.',
      'Put detail in supporting files next to `SKILL.md` and link them; Claude reads them only when needed.',
      'Set `disable-model-invocation: true` for anything with side effects (deploy, commit, send), so only you can start it.',
    ],
    avoid: [
      'Facts Claude needs in every session belong in `CLAUDE.md`, not in a skill it may not load.',
      'Rules that must be enforced belong in a hook or a permission rule; a skill is guidance, not a guarantee.',
    ],
    workflow: [
      'Create `.claude/skills/<name>/SKILL.md` (or use **New…** on the Skills group).',
      'Write the frontmatter: `description` first, then `when_to_use`, `argument-hint` and `allowed-tools` if needed.',
      'Write the body as short numbered steps; use `$ARGUMENTS`, `$0`, `$1` for what you pass after `/name`.',
      'Test both routes: type `/name`, and ask for the task in plain words to check Claude picks it.',
      'Run **Check Skill** here, and `/skill-doctor` in Claude Code to see its context cost and usage.',
    ],
    examples: [
      {
        title: 'A release-notes skill with arguments and pre-approved git commands',
        path: '.claude/skills/release-notes/SKILL.md',
        language: 'markdown',
        code: `---
description: Draft release notes from the commits since the last tag. Use when preparing a release or when asked what changed since a version.
argument-hint: [since-tag]
allowed-tools: Bash(git log *) Bash(git describe *)
---

Recent tags: !\`git describe --tags --abbrev=0\`

1. List the commits since $0 (or the latest tag when no argument is given).
2. Group them into Features, Fixes and Internal; drop merge commits.
3. Write one line per change in the imperative mood, with the PR number when present.
4. For the full style rules, see [style.md](style.md).`,
        note: '`!`command`` runs before Claude sees the skill and inserts the output.',
      },
    ],
    commands: [
      ['/name [arguments]', 'Run a skill yourself'],
      ['/skills', 'List skills and set their visibility (writes skillOverrides)'],
      ['/skill-doctor', 'Context cost of each skill and which ones are never used'],
      ['/add-dir <subdir>', 'Load nested skills from a subfolder straight away'],
    ],
    settings: [
      ['skillOverrides', '`{ "<name>": "on" | "name-only" | "user-invocable-only" | "off" }`: hide or collapse a skill without editing it. Not for plugin skills.'],
      ['disableBundledSkills', 'Turn off the skills that ship with Claude Code, such as /code-review.'],
      ['disableSkillShellExecution', 'Stop `!`command`` injection in skills.'],
      ['permissions.deny: Skill(name *)', 'Stop Claude from invoking a skill.'],
    ],
    gotchas: [
      'Claude sees `description` + `when_to_use` truncated at **1,536 characters**; put the trigger situations first.',
      '`allowed-tools` pre-approves tools only for the turn that invokes the skill.',
      'A `SKILL.md` wins over a `.claude/commands/` file with the same name.',
      'Keep `SKILL.md` under about 500 lines; move reference material into linked files.',
      '`context: fork` runs the skill in a subagent that does not see your conversation.',
    ],
    troubleshooting: [
      ['Claude never picks the skill', 'Rewrite the description as "does X. Use when Y", check it is not `disable-model-invocation: true` or hidden by `skillOverrides`.'],
      ['`/name` does not exist', 'The file must be named exactly `SKILL.md` inside a folder; the folder name is the command.'],
      ['An injected command fails', 'Exit codes of 2 or more abort the skill; append `|| true` to commands that may fail.'],
      ['A nested skill is missing', 'It loads when Claude first edits a file in that folder; use `/add-dir` or `/subdir:name`.'],
    ],
    prompts: [
      {
        id: 'procedure',
        label: 'Create a skill from a procedure',
        detail: 'Describe what it does and when Claude should use it',
        fields: [
          { key: 'name', label: 'Skill name (the command you type)', placeholder: 'release-notes' },
          { key: 'what', label: 'What should it do?', placeholder: 'draft release notes from commits since the last tag' },
          { key: 'when', label: 'When should Claude use it?', placeholder: 'preparing a release, or asked what changed since a version' },
          SCOPE_FIELD,
          {
            key: 'invocation',
            label: 'Who may start it?',
            choices: [
              { label: 'Claude and me', value: 'Both Claude and I may invoke it.' },
              { label: 'Only me', value: 'It has side effects, so set disable-model-invocation: true; only I may invoke it.' },
            ],
          },
        ],
        template: framePrompt({
          goal: 'Create a Claude Code skill named {{name}} that will {{what}}, placed at {{scope}}.',
          inspect: [
            'My existing skills in ~/.claude/skills and .claude/skills, to match their style and avoid a name that overrides or is overridden by another.',
            'The files and commands this procedure touches in the project, so the steps use the real paths and scripts.',
          ],
          requirements: [
            'Folder `{{name}}/` with a file named exactly SKILL.md; the folder name is the command.',
            'Frontmatter description: what it does, then "Use when {{when}}". Keep description plus when_to_use under 1,536 characters, trigger situations first.',
            '{{invocation}}',
            'Body: short numbered steps. Use $ARGUMENTS or $0, $1 for input, and add argument-hint when it takes arguments.',
            'Pre-approve only the tools it needs with allowed-tools, using narrow patterns such as Bash(git log *).',
            'Keep SKILL.md under 500 lines; put long reference material in a linked file next to it.',
          ],
          verify: [
            'Give me three prompts that should trigger it and two that should not.',
            'Tell me how to run it as /{{name}}.',
          ],
        }),
      },
      {
        id: 'from-repeated-prompt',
        label: 'Turn instructions I keep repeating into a skill',
        detail: 'Paste the text you keep typing',
        fields: [
          { key: 'text', label: 'The instructions you keep repeating', placeholder: 'When you write a migration, always …' },
          SCOPE_FIELD,
        ],
        template: framePrompt({
          goal: 'Turn these instructions, which I keep repeating, into a Claude Code skill at {{scope}}: "{{text}}"',
          inspect: [
            'My CLAUDE.md files and existing skills, in case this already exists or belongs in CLAUDE.md instead (because it applies to every session).',
          ],
          requirements: [
            'Propose a short kebab-case name; the folder name becomes the command.',
            'Write a description that states what it does and "Use when …" with the situations in which I have been typing these instructions.',
            'Rewrite the instructions as clear numbered steps, removing anything Claude already knows.',
            'If it should apply to every session rather than on demand, say so and recommend CLAUDE.md or a rule instead.',
          ],
          verify: ['List two prompts that should now load the skill without me repeating the instructions.'],
        }),
      },
      {
        id: 'with-script',
        label: 'Create a skill that runs a script',
        detail: 'A procedure with a bundled helper script',
        fields: [
          { key: 'name', label: 'Skill name', placeholder: 'db-backup' },
          { key: 'purpose', label: 'What should the script do?', placeholder: 'dump the local Postgres database to backups/ with a timestamp' },
          {
            key: 'language',
            label: 'Script language',
            choices: [
              { label: 'Bash', value: 'a POSIX bash script (shellcheck-clean, set -euo pipefail)' },
              { label: 'Python', value: 'a Python 3 script using only the standard library' },
              { label: 'Node.js', value: 'a Node.js script using only built-in modules' },
            ],
          },
          SCOPE_FIELD,
        ],
        template: framePrompt({
          goal: 'Create a Claude Code skill named {{name}} at {{scope}} that uses a bundled script to {{purpose}}.',
          inspect: ['The project for the tools, paths and configuration the script needs, and any existing script that already does part of this.'],
          requirements: [
            'Put the script in `{{name}}/scripts/` next to SKILL.md, written as {{language}}.',
            'Call it from SKILL.md with ${CLAUDE_SKILL_DIR}/scripts/…, so it works wherever the skill is installed.',
            'The script must fail loudly with a clear message, never silently, and must not print credentials.',
            'Frontmatter: a description with "Use when …", and allowed-tools limited to running that script.',
            'Set disable-model-invocation: true if the script changes data or external systems.',
          ],
          verify: ['Run the script once in a safe way (for example a dry run) and show the output.'],
        }),
      },
      {
        id: 'from-anthropic-skills',
        label: 'Adopt a skill from github.com/anthropics/skills',
        detail: 'Install one of Anthropic\'s published example skills',
        fields: [
          { key: 'skill', label: 'Which skill from anthropics/skills?', placeholder: 'pdf' },
          SCOPE_FIELD,
        ],
        template: framePrompt({
          goal: 'Install the "{{skill}}" skill from https://github.com/anthropics/skills at {{scope}}.',
          inspect: [
            'The skill\'s folder in that repository: its SKILL.md, scripts and any dependencies it expects.',
            'My existing skills, for a name that would override or be overridden.',
          ],
          requirements: [
            'Copy the whole skill folder, keeping supporting files and scripts next to SKILL.md.',
            'List any dependencies it needs (Python packages, CLIs) and how to install them; do not install anything without asking.',
            'Point out anything in it that runs commands or reaches the network.',
          ],
          verify: ['Show me how to invoke it and one prompt that should trigger it.'],
        }),
      },
    ],
    links: [
      doc('Skills documentation', 'skills'),
      { label: 'Anthropic example skills (download)', url: 'https://github.com/anthropics/skills', kind: 'download' },
      { label: 'Agent Skills open standard', url: 'https://agentskills.io', kind: 'reference' },
      { label: 'Plugin catalog with ready-made skills', url: 'https://claude.com/plugins', kind: 'catalog' },
    ],
    related: ['command', 'agent', 'plugin', 'memory'],
    docs: `${D}/skills`,
  },

  command: {
    title: 'Slash commands',
    summary: 'Single-file commands you invoke as /name; the simpler form of a skill.',
    what: 'A markdown file in a `commands/` folder that becomes `/name`. Custom commands have been merged into skills: `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy` and accept the same frontmatter. A command is one flat file with no room for supporting files.',
    where: [
      '`~/.claude/commands/<name>.md`: personal, every project',
      '`.claude/commands/<name>.md`: this project',
      'Plugins: `<plugin>/commands/<name>.md`, invoked as `/plugin:name`',
      'The file name (without `.md`) is the command.',
    ],
    use: [
      'Use for a short prompt you trigger yourself, such as a checklist or a canned review request.',
      '`$ARGUMENTS` is replaced with everything after the command; `$0`, `$1` pick single arguments.',
      'No frontmatter is required: the first line becomes the description.',
    ],
    avoid: [
      'New work with supporting files or scripts is better as a skill folder.',
      'If a skill with the same name exists, the skill wins and the command never runs.',
    ],
    workflow: [
      'Create `.claude/commands/<name>.md` (or **New…** on the Commands group).',
      'Add `description` and `argument-hint` frontmatter so the / menu explains it.',
      'Write the prompt body using `$ARGUMENTS`.',
      'Type `/<name> …` in Claude Code to run it.',
    ],
    examples: [
      {
        title: 'A review command that takes a focus area',
        path: '.claude/commands/review.md',
        language: 'markdown',
        code: `---
description: Review the current diff with a given focus
argument-hint: [focus-area]
allowed-tools: Bash(git diff *)
disable-model-invocation: true
---

Review the output of \`git diff\` focusing on $ARGUMENTS.
List issues by severity with file and line, then suggest the smallest fix for each.`,
      },
    ],
    commands: [
      ['/name [arguments]', 'Run the command'],
      ['/skills', 'Commands are listed with skills and share skillOverrides'],
    ],
    settings: [['skillOverrides', 'Hide or collapse a command by name, as for skills.']],
    gotchas: [
      'Built-in commands such as /help, /config and /mcp are listed on the Commands page of the docs; a custom command with the same name as a bundled skill replaces it.',
      'Arguments use shell-style quoting: wrap multi-word values in quotes to keep them as one `$0`.',
    ],
    troubleshooting: [
      ['The command does not appear', 'Check the file ends in `.md` and sits directly in a `commands/` folder; restart if it was added mid-session in an unwatched folder.'],
      ['A different command runs', 'A skill with the same name wins; rename one of them or use Show in Overview → Overrides.'],
    ],
    prompts: [
      {
        id: 'with-arguments',
        label: 'Create a command with arguments',
        detail: 'A prompt you run as /name with input',
        fields: [
          { key: 'name', label: 'Command name', placeholder: 'review' },
          { key: 'what', label: 'What should it do?', placeholder: 'review the current diff' },
          { key: 'args', label: 'What will you pass as arguments?', placeholder: 'the area to focus on' },
          SCOPE_FIELD,
        ],
        template: framePrompt({
          goal: 'Create a slash command /{{name}} at {{scope}} that will {{what}}, taking {{args}} as its arguments.',
          inspect: ['Existing commands and skills, so /{{name}} does not collide with one of them.'],
          requirements: [
            'One file, {{name}}.md, in the commands folder of that scope.',
            'Frontmatter: description (one line), argument-hint describing {{args}}, and allowed-tools only if it needs tools pre-approved.',
            'Use $ARGUMENTS for the input; mention in the body what to do when no argument is given.',
            'If it has side effects, add disable-model-invocation: true.',
          ],
          verify: ['Show an example invocation and what it would do.'],
        }),
      },
      {
        id: 'convert-to-skills',
        label: 'Convert my commands into skills',
        detail: 'Move flat commands to skill folders without breaking /names',
        fields: [SCOPE_FIELD],
        template: framePrompt({
          goal: 'Convert the slash commands at {{scope}} into skills, keeping every /name working.',
          inspect: ['Every .md file in the commands folder, and existing skills with the same names.'],
          requirements: [
            'For each command create <name>/SKILL.md in the matching skills folder with the same body and frontmatter.',
            'Add a description with "Use when …" so Claude can also pick it automatically, unless it has side effects (then disable-model-invocation: true).',
            'Keep $ARGUMENTS handling unchanged.',
            'Delete a command file only after I confirm the skill works.',
          ],
          verify: ['List each /name and whether it now resolves to the skill.'],
        }),
      },
    ],
    links: [doc('Skills (commands are part of skills)', 'skills'), doc('Built-in commands', 'commands')],
    related: ['skill', 'keybinding'],
    docs: `${D}/skills`,
  },

  agent: {
    title: 'Subagents',
    summary: 'Specialised Claudes with their own prompt, tools and context window.',
    what: 'A markdown file whose frontmatter defines a separate Claude: its name, when to delegate to it, which tools it may use and which model it runs on. Its work happens in its own context window, so searching a large codebase or reviewing many files does not fill your conversation. Taking tools away is a real limit: a subagent without Edit and Write cannot change files.',
    where: [
      '`~/.claude/agents/<name>.md`: personal, every project',
      '`.claude/agents/<name>.md`: this project',
      'Plugins: `<plugin>/agents/`; managed settings can ship them too',
      'Precedence when names clash: managed > `--agents` flag > project > user > plugin.',
    ],
    use: [
      'Use for work where the input is large and the output is a conclusion: codebase search, review, research.',
      'Restrict `tools:` (allowlist) or `disallowedTools:` to make a rule a mechanism.',
      'Write `description` as "Use this agent when …" so Claude delegates at the right moment.',
      'Invoke explicitly with `@agent-<name>`, or run a whole session as it with `claude --agent <name>`.',
    ],
    avoid: [
      'Short tasks that need your conversation\'s context: a subagent does not see the conversation history.',
      'Procedures you want in the main conversation; that is a skill.',
    ],
    workflow: [
      'Create `.claude/agents/<name>.md` with `---` on the very first line.',
      'Set `name` (lowercase, hyphens) and `description`, then `tools`, `model` and optionally `memory`.',
      'Write the body as the subagent\'s system prompt: role, method, and the exact shape of what it returns.',
      'Try it with `@agent-<name> <task>` and check it only used the tools you allowed.',
    ],
    examples: [
      {
        title: 'A read-only reviewer that remembers project conventions',
        path: '.claude/agents/code-reviewer.md',
        language: 'markdown',
        code: `---
name: code-reviewer
description: Use this agent when code has just been written or changed and needs review for correctness, security and project conventions.
tools: Read, Grep, Glob, Bash(git diff *)
model: sonnet
memory: project
---

You are a senior reviewer. Read the changed files and their callers.
Report findings as a list ordered by severity, each with file:line, the problem and the smallest fix.
Consult your memory for conventions first, and record new ones you confirm.`,
      },
    ],
    commands: [
      ['@agent-<name> <task>', 'Delegate to a specific subagent'],
      ['claude --agent <name>', 'Run the whole session as that subagent'],
      ['claude --agents \'{…}\'', 'Define subagents for one session as JSON'],
      ['claude plugin validate .claude/agents', 'Check the frontmatter before a session'],
    ],
    settings: [
      ['agent', 'Run every session in this scope as the named subagent.'],
      ['permissions.deny: Agent(name)', 'Stop Claude from using a subagent, built-in ones included.'],
      ['CLAUDE_CODE_SUBAGENT_MODEL', 'Environment variable: default model for subagents.'],
    ],
    gotchas: [
      'Files are skipped silently when `---` is not on line 1, `name` is missing, or YAML does not parse. Run with `--debug` to see why.',
      '`model: inherit` uses the main conversation\'s model; omitting tools inherits all of them.',
      '`memory: project` stores notes in `.claude/agent-memory/<name>/`, which is committed unless you ignore it; `local` keeps them private.',
      'Combined descriptions over 15,000 tokens trigger a warning: keep each description short.',
    ],
    troubleshooting: [
      ['Claude never delegates to it', 'Make the description start with "Use this agent when …" and name concrete situations; or call it with @agent-name.'],
      ['It is not listed at all', 'Check `---` is on the first line and `name` has no `:` and does not start with `-`.'],
      ['It edits files it should not', 'Set an explicit `tools:` allowlist; without it the subagent inherits every tool.'],
    ],
    prompts: [
      {
        id: 'reviewer',
        label: 'Create a read-only reviewer',
        detail: 'Reviews code without being able to change it',
        fields: [
          { key: 'name', label: 'Subagent name', placeholder: 'code-reviewer' },
          { key: 'focus', label: 'What should it review for?', placeholder: 'security issues and missing error handling' },
          SCOPE_FIELD,
        ],
        template: framePrompt({
          goal: 'Create a read-only subagent named {{name}} at {{scope}} that reviews code for {{focus}}.',
          inspect: ['Existing subagents, so the name is unique, and the project\'s conventions it should enforce (CLAUDE.md, linters, rules).'],
          requirements: [
            'Frontmatter with --- on line 1: name {{name}}, description starting "Use this agent when …" with two concrete situations.',
            'tools limited to Read, Grep, Glob and read-only git commands; no Edit, Write or unrestricted Bash.',
            'Body: its role, the review method, and an exact output format (severity, file:line, problem, smallest fix).',
          ],
          verify: ['Show how to invoke it with @agent-{{name}} and what a typical report looks like.'],
        }),
      },
      {
        id: 'specialist',
        label: 'Create a specialist with restricted tools',
        detail: 'A subagent that can do one kind of work and nothing else',
        fields: [
          { key: 'name', label: 'Subagent name', placeholder: 'migration-writer' },
          { key: 'task', label: 'What should it do?', placeholder: 'write database migrations from a schema change description' },
          { key: 'tools', label: 'Which tools may it use?', placeholder: 'Read, Grep, Glob, Write, Bash(npm run migrate *)' },
          { key: 'forbid', label: 'What must it never be able to do?', placeholder: 'run migrations against production', optional: true },
          SCOPE_FIELD,
        ],
        template: framePrompt({
          goal: 'Create a subagent named {{name}} at {{scope}} that will {{task}}.',
          inspect: ['Where this kind of work lives in the project, and any scripts or conventions it must follow.'],
          requirements: [
            'tools: exactly {{tools}}; nothing else is inherited.',
            '{{#forbid}}It must be technically unable to {{forbid}}: choose tools and permissionMode so that is enforced, not just requested.{{/forbid}}',
            'description: "Use this agent when …" with concrete triggers.',
            'Body: step-by-step method and the exact result it returns to the main conversation.',
            'Choose model deliberately (haiku for simple, sonnet or inherit for complex work) and explain the choice.',
          ],
          verify: ['Explain which of its tools could modify files or run commands, and why each is needed.'],
        }),
      },
      {
        id: 'memory',
        label: 'Create a subagent with persistent memory',
        detail: 'Learns project conventions across sessions',
        fields: [
          { key: 'name', label: 'Subagent name', placeholder: 'api-expert' },
          { key: 'domain', label: 'What area should it build knowledge about?', placeholder: 'our REST API conventions and error handling' },
          {
            key: 'memoryScope',
            label: 'Where should its memory live?',
            choices: [
              { label: 'project', value: 'project', detail: '.claude/agent-memory/, shareable through git' },
              { label: 'local', value: 'local', detail: '.claude/agent-memory-local/, not committed' },
              { label: 'user', value: 'user', detail: '~/.claude/agent-memory/, across all projects' },
            ],
          },
        ],
        template: framePrompt({
          goal: 'Create a subagent named {{name}} that becomes the expert on {{domain}} and keeps what it learns in memory: {{memoryScope}}.',
          requirements: [
            'Frontmatter: name, description ("Use this agent when …"), memory: {{memoryScope}}, and a tool list that fits the task.',
            'Body: tell it to consult its memory before starting and to record conventions it has confirmed, one line each, keeping MEMORY.md under 200 lines.',
            'If memoryScope is project, tell me whether .claude/agent-memory/ should be committed or ignored.',
          ],
          verify: ['Describe what it will write to memory after a first run, with an example entry.'],
        }),
      },
    ],
    links: [
      doc('Subagents documentation', 'sub-agents'),
      doc('Running agents in parallel', 'agents'),
      { label: 'Plugin catalog with ready-made agents', url: 'https://claude.com/plugins', kind: 'catalog' },
    ],
    related: ['skill', 'workflow', 'hook'],
    docs: `${D}/sub-agents`,
  },

  rule: {
    title: 'Rules',
    summary: 'Instructions that load like CLAUDE.md, optionally only for matching files.',
    what: 'Markdown files in `.claude/rules/` that Claude Code loads as project instructions. A rule without `paths:` loads at launch like `CLAUDE.md`; a rule with `paths:` globs loads only when Claude reads a matching file, so an instruction about Terraform costs nothing until Terraform is in play.',
    where: [
      '`.claude/rules/**/*.md`: this project; subfolders are discovered recursively',
      '`~/.claude/rules/*.md`: personal, every project, loaded before project rules',
      'Symlinks work; a target outside the project needs external imports approved.',
    ],
    use: [
      'Use when an instruction applies to some files (a language, a package, tests) and would be noise elsewhere.',
      'One topic per file, with a descriptive name such as `testing.md` or `api-design.md`.',
      'Share a set of rules across projects by keeping them in `~/.claude/rules/`.',
    ],
    avoid: [
      'A rule without `paths:` is not cheaper than CLAUDE.md; only use it for organisation.',
      'Something that must always happen belongs in a hook; rules are guidance.',
    ],
    workflow: [
      'Create `.claude/rules/<topic>.md`.',
      'Add `paths:` frontmatter with one or more globs, or leave it out to load every session.',
      'Write concrete, checkable instructions ("Use 2-space indentation", not "format nicely").',
      'Open a matching file in a Claude Code session and run `/context` to confirm it loaded.',
    ],
    examples: [
      {
        title: 'Rules that load only for API code',
        path: '.claude/rules/api.md',
        language: 'markdown',
        code: `---
paths:
  - "src/api/**/*.ts"
  - "src/**/*.{route,handler}.ts"
---

# API development

- Validate every request body with the schemas in src/api/schemas.
- Return errors in the { code, message } format from src/api/errors.ts.
- Add an OpenAPI comment above each handler.`,
      },
    ],
    commands: [
      ['/context', 'See which memory files and rules loaded in this session'],
      ['/memory', 'Open memory files, including rules'],
    ],
    settings: [['claudeMdExcludes', 'Glob patterns on absolute paths to skip rules (and CLAUDE.md files) you do not want loaded.']],
    gotchas: [
      '`paths:` rules trigger when Claude reads a matching file, not on every tool use.',
      'Glob `[` starts a bracket expression; escape a literal one as `\\[`.',
      'Each brace group multiplies patterns; a rule\'s `paths` list shares a budget of 1,000 expanded patterns.',
      'A rule excluded with `claudeMdExcludes` never loads, whatever its paths.',
    ],
    troubleshooting: [
      ['The rule never applies', 'Check the glob against the path relative to the project root, and whether Claude actually read a matching file; `/context` shows what loaded.'],
      ['It loads everywhere', 'The frontmatter is missing or `---` is not on the first line, so `paths:` was not read.'],
    ],
    prompts: [
      {
        id: 'path-scoped',
        label: 'Create a path-scoped rule',
        detail: 'Instructions for some files only',
        fields: [
          { key: 'glob', label: 'Which files? (glob)', placeholder: 'src/api/**/*.ts' },
          { key: 'instruction', label: 'What should Claude do for those files?', placeholder: 'validate request bodies with the shared schemas' },
        ],
        template: framePrompt({
          goal: 'Create a rule in .claude/rules/ that applies only to {{glob}} and says: {{instruction}}.',
          inspect: [
            'Which files the glob matches today, so it is neither too broad nor empty.',
            'CLAUDE.md and existing rules, for instructions that already say this or contradict it.',
          ],
          requirements: [
            'One topic file with a descriptive name; frontmatter paths: with the glob quoted.',
            'Concrete, checkable instructions that reference real files, schemas or scripts in the project.',
            'Remove any duplicate of this instruction from CLAUDE.md once the rule covers it.',
          ],
          verify: ['List three files it will load for and one it will not.'],
        }),
      },
      {
        id: 'split-claude-md',
        label: 'Split CLAUDE.md into path-scoped rules',
        detail: 'Load instructions only where they apply',
        fields: [],
        template: framePrompt({
          goal: 'Reduce what loads in every session by moving file-specific instructions from CLAUDE.md into path-scoped rules.',
          inspect: ['Every CLAUDE.md, CLAUDE.local.md and existing rule in this project, and the directory layout.'],
          requirements: [
            'Identify instructions that only matter for certain files: a language, a package, tests, infrastructure.',
            'Move each group into .claude/rules/<topic>.md with a paths: glob that matches exactly those files.',
            'Keep in CLAUDE.md only what every session needs; aim for under 200 lines.',
            'Estimate the tokens saved per session (characters ÷ 4).',
          ],
          verify: ['For each new rule, name a file that triggers it.'],
        }),
      },
      {
        id: 'language-conventions',
        label: 'Add language conventions',
        detail: 'Style and patterns for one language',
        fields: [
          {
            key: 'language',
            label: 'Which language?',
            choices: [
              { label: 'TypeScript', value: 'TypeScript (**/*.{ts,tsx})' },
              { label: 'Python', value: 'Python (**/*.py)' },
              { label: 'Go', value: 'Go (**/*.go)' },
              { label: 'Rust', value: 'Rust (**/*.rs)' },
              { label: 'Java', value: 'Java (**/*.java)' },
            ],
          },
          { key: 'conventions', label: 'Conventions to enforce (optional)', placeholder: 'no default exports; errors as Result types', optional: true },
        ],
        template: framePrompt({
          goal: 'Create a path-scoped rule with the conventions for {{language}} in this project.',
          inspect: ['Existing code, linter and formatter configuration, to derive the conventions actually in use rather than generic advice.'],
          requirements: [
            'paths: glob for that language\'s files.',
            '{{#conventions}}Include these conventions: {{conventions}}.{{/conventions}}',
            'Only conventions that differ from language defaults or that the linter does not already enforce.',
            'Each as a short, checkable bullet with an example path where it helps.',
          ],
        }),
      },
    ],
    links: [doc('Memory and rules documentation', 'memory'), doc('What loads into the context window', 'context-window')],
    related: ['memory', 'skill', 'setting'],
    docs: `${D}/memory`,
  },

  outputStyle: {
    title: 'Output styles',
    summary: 'Change how Claude answers: role, tone and format, for every response.',
    what: 'An output style replaces or extends Claude Code\'s default instructions for how it responds. Built-ins are Default, Proactive, Concise, Explanatory and Learning. A custom style is a markdown file: frontmatter, then your instructions. By default a custom style drops Claude Code\'s software-engineering instructions; `keep-coding-instructions: true` keeps them.',
    where: [
      '`~/.claude/output-styles/*.md`: personal',
      '`.claude/output-styles/*.md`: this project (nested folders up to the repository root)',
      'Plugins: `output-styles/`; selected with the `outputStyle` setting',
    ],
    use: [
      'Use when you keep asking for the same voice or format: shorter answers, diagrams first, teaching mode.',
      'Use a style without coding instructions to make Claude a writing assistant or data analyst.',
      'Pick one with `/config` → Output style, or set `outputStyle` in a settings file.',
    ],
    avoid: [
      'Project facts and conventions belong in CLAUDE.md, not in a style.',
      'Styles do not change subagents, which run their own system prompt.',
    ],
    workflow: [
      'Create `~/.claude/output-styles/<name>.md`.',
      'Add `name`, `description` and, if you still code with it, `keep-coding-instructions: true`.',
      'Write the instructions: what to lead with, length, structure, what to always include.',
      'Select it in `/config` → Output style; it applies from your next message.',
    ],
    examples: [
      {
        title: 'Diagrams first, keeping coding behaviour',
        path: '~/.claude/output-styles/diagrams-first.md',
        language: 'markdown',
        code: `---
name: Diagrams first
description: Lead every explanation with a diagram
keep-coding-instructions: true
---

When explaining code, architecture or data flow, start with a Mermaid diagram, then explain in prose.
Use flowchart TD for control flow and sequenceDiagram for request paths. Keep diagrams under 15 nodes.`,
      },
    ],
    commands: [['/config → Output style', 'Choose a style; saved to .claude/settings.local.json']],
    settings: [['outputStyle', 'The active style by name, such as "Concise" or a custom style\'s name.']],
    gotchas: [
      'The old `/output-style` command was removed; use `/config`.',
      'In the terminal, style files are read at startup: restart after creating or editing one.',
      'Explanatory and Learning produce longer answers and more output tokens by design.',
      'A plugin style with `force-for-plugin: true` overrides your `outputStyle` while that plugin is enabled.',
    ],
    troubleshooting: [
      ['My style is not in the list', 'Restart Claude Code; check the file is in an `output-styles` folder and ends in `.md`.'],
      ['Claude stopped following coding practices', 'Add `keep-coding-instructions: true` to the style.'],
    ],
    prompts: [
      {
        id: 'coding-style',
        label: 'Create a style that keeps coding behaviour',
        detail: 'Change how answers read, not how Claude codes',
        fields: [
          { key: 'name', label: 'Style name', placeholder: 'Terse reviewer' },
          { key: 'how', label: 'How should answers change?', placeholder: 'lead with the result, bullet points only, no preamble' },
          SCOPE_FIELD,
        ],
        template: framePrompt({
          goal: 'Create an output style named "{{name}}" at {{scope}} that makes answers {{how}}, while keeping Claude Code\'s coding instructions.',
          requirements: [
            'Markdown file in the output-styles folder of that scope with name, description and keep-coding-instructions: true.',
            'Instructions that are specific and testable (length limits, what comes first, formats), not adjectives.',
            'State what must never be shortened: error details, security warnings, confirmations of destructive actions.',
          ],
          verify: ['Tell me how to select it in /config, and show a short before/after example answer.'],
        }),
      },
      {
        id: 'role',
        label: 'Create a non-coding role',
        detail: 'Writing assistant, analyst, tutor…',
        fields: [{ key: 'role', label: 'Which role?', placeholder: 'a technical writer who edits documentation for clarity' }],
        template: framePrompt({
          goal: 'Create a user-level output style that makes Claude act as {{role}}.',
          requirements: [
            'Leave keep-coding-instructions out (false), because this is not software engineering.',
            'Describe the role, the workflow it follows, the output format, and when to ask me questions.',
          ],
          verify: ['Explain how to switch between this style and Default.'],
        }),
      },
    ],
    links: [
      doc('Output styles documentation', 'output-styles'),
      { label: 'Style plugins (explanatory, learning) in the catalog', url: 'https://claude.com/plugins', kind: 'catalog' },
    ],
    related: ['memory', 'setting', 'agent'],
    docs: `${D}/output-styles`,
  },

  theme: {
    title: 'Themes',
    summary: 'Terminal colours for Claude Code; cosmetic only.',
    what: 'A JSON file with a `base` of `dark` or `light` and a sparse `overrides` map of colour names. Plugins can ship themes; pressing `Ctrl+E` on a plugin theme in `/theme` copies it to `~/.claude/themes/` so you can edit the copy.',
    where: ['`~/.claude/themes/<name>.json`: your themes', 'Plugins: `themes/` (read-only)'],
    use: [
      'Use when the built-in themes clash with your terminal colours or accessibility needs.',
      'Start from a copy of an existing theme rather than from scratch.',
    ],
    workflow: [
      'Run `/theme` in Claude Code to see the available themes.',
      'Press `Ctrl+E` on one to copy it into `~/.claude/themes/`, or create a JSON file there.',
      'Change only the colours you need in `overrides`.',
      'Select it again in `/theme`.',
    ],
    examples: [
      {
        title: 'A dark theme with custom accent colours',
        path: '~/.claude/themes/dracula.json',
        language: 'json',
        code: `{
  "name": "Dracula",
  "base": "dark",
  "overrides": {
    "claude": "#bd93f9",
    "error": "#ff5555",
    "success": "#50fa7b"
  }
}`,
      },
    ],
    commands: [['/theme', 'Pick a theme; Ctrl+E copies a plugin theme for editing']],
    gotchas: ['`base` must be `dark` or `light`.', 'Plugin themes are read-only; edit the copy in `~/.claude/themes/`.'],
    prompts: [
      {
        id: 'palette',
        label: 'Create a theme from a palette',
        detail: 'Base theme plus your colours',
        fields: [
          { key: 'name', label: 'Theme name', placeholder: 'Solarized Dark' },
          {
            key: 'base',
            label: 'Base',
            choices: [
              { label: 'dark', value: 'dark' },
              { label: 'light', value: 'light' },
            ],
          },
          { key: 'colors', label: 'Which colours or palette?', placeholder: 'Solarized accents for errors, success and Claude' },
        ],
        template: framePrompt({
          goal: 'Create a Claude Code theme named "{{name}}" in ~/.claude/themes/ based on {{base}} with {{colors}}.',
          inspect: ['Existing theme files in ~/.claude/themes/ for the override keys already in use.'],
          requirements: [
            'JSON with name, base and a sparse overrides map; only override what differs from the base.',
            'Keep text contrast readable (WCAG AA) against the terminal background.',
          ],
          verify: ['Tell me how to select it with /theme.'],
        }),
      },
      {
        id: 'accessible',
        label: 'Adjust a theme for readability',
        detail: 'Better contrast or colour-blind friendly',
        fields: [
          {
            key: 'need',
            label: 'What should improve?',
            choices: [
              { label: 'Higher contrast', value: 'higher contrast for low-vision use' },
              { label: 'Colour-blind friendly', value: 'red/green distinctions replaced by colours that work with deuteranopia' },
            ],
          },
        ],
        template: framePrompt({
          goal: 'Create a theme in ~/.claude/themes/ with {{need}}.',
          requirements: ['Start from the base theme I use now, override only what is needed, and explain each change.'],
        }),
      },
    ],
    links: [doc('Theme format (plugins reference)', 'plugins-reference')],
    related: ['keybinding', 'plugin'],
    docs: `${D}/plugins-reference`,
  },

  workflow: {
    title: 'Workflows',
    summary: 'Scripts that orchestrate many subagents in the background, repeatably.',
    what: 'A dynamic workflow is a JavaScript script, usually written by Claude for your task, that the runtime executes in the background: it fans out subagents over many items, verifies results and merges them, while your session stays free. Saved workflows become commands. `/deep-research` is the bundled one.',
    where: [
      '`.claude/workflows/*.js`: saved for the project',
      '`~/.claude/workflows/*.js`: saved for you, every project',
      'Plugins: `workflows/`, run as `/plugin:name`',
    ],
    use: [
      'Use for work too big for one conversation: audits across many files, migrations, cross-checked research.',
      'Ask for one with "use a workflow to …" or the keyword `ultracode` in your prompt.',
      'Watch and control runs with `/workflows`; press `s` there to save a run as a command.',
    ],
    avoid: [
      'Small or one-off questions: a run spawns real agents and can use far more tokens.',
      'Tasks that need your input mid-way; a run cannot ask you questions.',
    ],
    workflow: [
      'Describe the task: "use a workflow to audit every route under src/routes/ for missing auth checks".',
      'Approve the planned phases (View raw script shows the code).',
      'Follow progress with `/workflows`; stop or pause from there.',
      'If it did what you wanted, press `s` in `/workflows` to save it as a reusable `/name`.',
    ],
    examples: [
      {
        title: 'The shape of a saved workflow',
        path: '.claude/workflows/audit-routes.js',
        language: 'javascript',
        code: `export const meta = {
  name: 'audit-routes',
  description: 'Audit every route handler for missing auth checks',
}

const found = await agent('List every .ts file under src/routes/.', {
  schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
})

const audits = await pipeline(found.files, (file) =>
  agent(\`Audit \${file} for missing authentication checks.\`, { label: file }),
)

return audits.filter(Boolean)`,
      },
    ],
    commands: [
      ['/workflows', 'List runs, watch progress, pause, stop, save'],
      ['/deep-research <question>', 'Bundled research workflow with cross-checked sources'],
      ['/effort ultracode', 'Let Claude plan a workflow for every substantive task'],
      ['/workflow-authoring', 'Load the script reference before editing a saved workflow'],
    ],
    settings: [
      ['disableWorkflows', 'Turn workflows off (also CLAUDE_CODE_DISABLE_WORKFLOWS=1).'],
      ['workflowSizeGuideline', '`unrestricted`, `small`, `medium` or `large`: how many agents Claude aims for.'],
      ['permissions.allow: Workflow(<name>)', 'Approve a saved workflow in -p runs and the Agent SDK.'],
    ],
    gotchas: [
      'Limits per run: 16 concurrent agents, 4,096 items per `parallel()`/`pipeline()` call, 1,000 agents total.',
      '`Date.now()` and `Math.random()` throw inside a script so relaunched runs repeat the same calls.',
      'On Pro, turn workflows on from the Dynamic workflows row in `/config`.',
    ],
    troubleshooting: [
      ['A saved workflow is not in the / menu', 'Keep `export const meta = { name, description }` as the first statement, with literal values only.'],
      ['The run uses too many tokens', 'Try a small slice first, or set `workflowSizeGuideline` to `small`.'],
    ],
    prompts: [
      {
        id: 'audit',
        label: 'Audit many files for the same issue',
        detail: 'Fan out one agent per file, verify findings',
        fields: [
          { key: 'issue', label: 'What should be found?', placeholder: 'missing authentication checks' },
          { key: 'where', label: 'Where?', placeholder: 'every route handler under src/routes/' },
        ],
        template: framePrompt({
          goal: 'Use a workflow to audit {{where}} for {{issue}}.',
          requirements: [
            'Fan out one agent per file or small group of files.',
            'Adversarially verify each finding with a second agent before reporting it; drop findings that do not survive.',
            'Merge into one report ordered by severity, each with file:line and a suggested fix.',
            'Run it on a small slice first and tell me the token usage before running on everything.',
          ],
          verify: ['After the run, tell me how to save it with /workflows → s if I want to rerun it.'],
          deliver: 'Show me the planned phases before starting. Do not change any files; report only.',
        }),
      },
      {
        id: 'fix-until-green',
        label: 'Keep fixing until a check passes',
        detail: 'Type check, lint or tests in rounds',
        fields: [{ key: 'check', label: 'Which command must pass?', placeholder: 'npx tsc --noEmit' }],
        template: framePrompt({
          goal: 'Use a workflow to run `{{check}}` and keep fixing what it reports until it passes.',
          requirements: [
            'Group errors by file and fix groups in parallel, each agent in its own isolated copy where edits could conflict.',
            'Stop when the check passes or when two rounds in a row make no progress, and report what remains.',
            'Do not change tests or configuration to make the check pass unless I approve it.',
          ],
          verify: ['Run the check once more at the end and show the result.'],
        }),
      },
      {
        id: 'migrate',
        label: 'Migrate many files in parallel',
        detail: 'Transform each file, verify each result',
        fields: [
          { key: 'migration', label: 'What migration?', placeholder: 'JavaScript to TypeScript' },
          { key: 'where', label: 'Which files?', placeholder: 'every component under src/components/' },
        ],
        template: framePrompt({
          goal: 'Use a workflow to migrate {{where}}: {{migration}}.',
          inspect: ['Two or three representative files first, and write down the migration recipe before fanning out.'],
          requirements: [
            'Each file in its own isolated copy so edits do not conflict.',
            'Verify each migrated file (build, type check or tests for that file) before accepting it.',
            'Report files that could not be migrated automatically, with the reason.',
          ],
        }),
      },
    ],
    links: [doc('Workflows documentation', 'workflows'), doc('Subagents, agent teams and workflows compared', 'agents')],
    related: ['agent', 'skill'],
    docs: `${D}/workflows`,
  },

  hook: {
    title: 'Hooks',
    summary: 'Commands Claude Code runs at fixed moments: the only way to enforce, not ask.',
    what: 'A hook is a handler Claude Code runs automatically at a lifecycle event: before or after a tool call, when you submit a prompt, when Claude stops, at session start and more (33 events). Handlers can be a shell `command`, an `http` POST, an `mcp_tool` call, a `prompt` to a model or an `agent`. A `PreToolUse` hook can block a tool call outright, which no instruction in CLAUDE.md can guarantee.',
    where: [
      '`hooks` in `~/.claude/settings.json`: every project',
      '`hooks` in `.claude/settings.json` (shared) or `.claude/settings.local.json` (private)',
      'Plugins: `hooks/hooks.json`; also in skill and subagent frontmatter',
      'Managed settings: organisation hooks you cannot disable',
    ],
    use: [
      'Use for guardrails (block destructive commands, protect files) and automation (format after edits, notify when waiting).',
      'The `matcher` filters by tool name for tool events: `Bash`, `Edit|Write`, `mcp__github__.*`.',
      'The `if` field narrows further with permission-rule syntax, such as `Bash(git *)`.',
      'Scripts receive the event as JSON on stdin; read it with `jq`.',
    ],
    avoid: [
      'Slow work on frequent events such as PreToolUse: every tool call waits for it.',
      'Anything a permission rule already expresses; rules are simpler and visible in /permissions.',
    ],
    workflow: [
      'Pick the event (PreToolUse to block, PostToolUse to react, Stop when Claude finishes, Notification when it waits).',
      'Write the script in `.claude/hooks/` and make it executable; read the event JSON from stdin.',
      'Add the handler under `hooks.<Event>[].hooks[]` with a `matcher`; reference the script as `"$CLAUDE_PROJECT_DIR"/.claude/hooks/…`.',
      'Check it in `/hooks`, then trigger the event and watch the result.',
    ],
    examples: [
      {
        title: 'Format files after every edit',
        path: '.claude/settings.json',
        language: 'json',
        code: `{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write", "timeout": 30 }
        ]
      }
    ]
  }
}`,
      },
      {
        title: 'Block rm -rf with a PreToolUse script',
        path: '.claude/hooks/block-rm.sh',
        language: 'bash',
        code: `#!/bin/bash
COMMAND=$(jq -r '.tool_input.command')
if echo "$COMMAND" | grep -q 'rm -rf'; then
  echo "Destructive command blocked by hook" >&2
  exit 2   # exit 2 blocks the tool call; stderr becomes the reason
fi
exit 0`,
      },
    ],
    commands: [
      ['/hooks', 'Read-only list of every configured hook and its source file'],
      ['claude --debug', 'Log hook execution, timing and errors'],
    ],
    settings: [
      ['disableAllHooks', 'Turn off hooks (and custom status line) from this scope; managed hooks stay on.'],
      ['allowManagedHooksOnly', 'Managed only: run only organisation hooks.'],
      ['allowedHttpHookUrls', 'Allowlist of URLs http hooks may call.'],
    ],
    gotchas: [
      '**Exit 2 blocks** on blocking events and stderr is shown to Claude; exit 1 and others are non-blocking errors.',
      'All hooks matching an event run **in parallel**; order in the file does not matter.',
      'Default timeout is 600 s for command hooks, 30 s on UserPromptSubmit, 30 s for prompt and 60 s for agent handlers.',
      'Hooks from every level merge; an identical handler in several settings files runs once.',
      'Settings-file hooks run before you trust a folder; review hooks in repositories you clone.',
    ],
    troubleshooting: [
      ['The hook never runs', 'Check the event name spelling, the matcher (exact names vs regex), that the script is executable, and `disableAllHooks`.'],
      ['"Script not found"', 'Quote the path and use `$CLAUDE_PROJECT_DIR`; relative paths depend on the working directory.'],
      ['It blocks everything', 'An exit code of 2 on every path, or a matcher of `*` where you meant one tool.'],
      ['Claude hangs after a tool call', 'A slow synchronous hook; lower `timeout`, or use `async: true` for fire-and-forget work.'],
    ],
    prompts: [
      {
        id: 'format-after-edit',
        label: 'Format files after every edit',
        detail: 'PostToolUse on Edit|Write',
        fields: [
          { key: 'formatter', label: 'Which formatter command?', placeholder: 'npx prettier --write', default: 'npx prettier --write' },
          SCOPE_FIELD,
        ],
        template: framePrompt({
          goal: 'Add a PostToolUse hook at {{scope}} that runs `{{formatter}}` on each file Claude edits or writes.',
          inspect: ['The project\'s formatter configuration and which file types it supports, and existing hooks so this is not duplicated.'],
          requirements: [
            'matcher Edit|Write; read tool_input.file_path from the JSON on stdin with jq.',
            'Only format file types the formatter supports; skip others silently with exit 0.',
            'Never block: formatting failures exit 0 and write a short note to stderr.',
            'timeout of 30 seconds or less.',
          ],
          verify: ['Show how to confirm it in /hooks, and edit one file to prove it formats.'],
        }),
      },
      {
        id: 'block-dangerous',
        label: 'Block dangerous shell commands',
        detail: 'PreToolUse on Bash with exit 2',
        fields: [
          { key: 'patterns', label: 'Which commands must be blocked?', placeholder: 'rm -rf, git push --force, DROP TABLE' },
          SCOPE_FIELD,
        ],
        template: framePrompt({
          goal: 'Add a PreToolUse hook at {{scope}} that blocks Bash commands matching: {{patterns}}.',
          requirements: [
            'Script in .claude/hooks/ (or ~/.claude/hooks/ for user level), executable, shellcheck-clean, reading tool_input.command with jq.',
            'Exit 2 with a clear reason on stderr when a pattern matches; exit 0 otherwise.',
            'Match on normalised command text, and handle compound commands (&&, ;, |) and leading env assignments.',
            'Reference it as "$CLAUDE_PROJECT_DIR"/.claude/hooks/<script> with matcher Bash.',
            'Also suggest matching permissions.deny rules, and explain what each layer catches that the other does not.',
          ],
          verify: ['Give me three commands it blocks and two similar ones it allows, and how to test them safely.'],
        }),
      },
      {
        id: 'notify',
        label: 'Notify me when Claude is waiting',
        detail: 'Notification and Stop events',
        fields: [
          {
            key: 'method',
            label: 'How should it notify you?',
            choices: [
              { label: 'macOS notification', value: 'a macOS notification with osascript' },
              { label: 'Linux notification', value: 'a desktop notification with notify-send' },
              { label: 'Sound', value: 'a short system sound' },
              { label: 'Terminal bell', value: 'the terminal bell' },
            ],
          },
        ],
        template: framePrompt({
          goal: 'Add user-level hooks that notify me with {{method}} when Claude Code needs my input or finishes a turn.',
          requirements: [
            'Notification event with matcher permission_prompt|idle_prompt, and a Stop hook, in ~/.claude/settings.json.',
            'Include the project folder name in the message so I know which session it is.',
            'Must never block: use async: true or make it return instantly.',
          ],
          verify: ['Tell me how to trigger each one to test it.'],
        }),
      },
      {
        id: 'custom',
        label: 'Custom hook',
        detail: 'Choose the event and describe the behaviour',
        fields: [
          {
            key: 'event',
            label: 'Which event?',
            choices: [
              { label: 'PreToolUse', value: 'PreToolUse', detail: 'before a tool call; can block' },
              { label: 'PostToolUse', value: 'PostToolUse', detail: 'after a tool call succeeds' },
              { label: 'UserPromptSubmit', value: 'UserPromptSubmit', detail: 'when you send a prompt; can block or add context' },
              { label: 'SessionStart', value: 'SessionStart', detail: 'at startup, resume, clear or compact' },
              { label: 'Stop', value: 'Stop', detail: 'when Claude finishes a turn; can make it continue' },
              { label: 'PreCompact', value: 'PreCompact', detail: 'before context compaction' },
            ],
          },
          { key: 'matcher', label: 'Matcher (tool name, list or regex; empty for all)', placeholder: 'Bash', optional: true },
          { key: 'behaviour', label: 'What should it do?', placeholder: 'add the current git branch to the context' },
          SCOPE_FIELD,
        ],
        template: framePrompt({
          goal: 'Add a {{event}} hook at {{scope}} that will {{behaviour}}.',
          inspect: ['Existing hooks for the same event, and what the event receives on stdin according to the hooks reference.'],
          requirements: [
            '{{#matcher}}matcher: {{matcher}}.{{/matcher}}',
            'Choose the simplest handler type (command, http, prompt or agent) and say why.',
            'Use exit codes and JSON output exactly as documented for {{event}}; state whether it blocks.',
            'Keep it fast, with an explicit timeout, and quote every path.',
          ],
          verify: ['Explain how to see it in /hooks and how to trigger it once.'],
        }),
      },
    ],
    links: [
      doc('Hooks guide', 'hooks-guide'),
      { label: 'Hooks reference: events, input, exit codes', url: `${D}/hooks`, kind: 'reference' },
      { label: 'jq, used to read hook input (download)', url: 'https://jqlang.org/download/', kind: 'download' },
    ],
    related: ['setting', 'agent', 'skill'],
    docs: `${D}/hooks`,
  },

  mcp: {
    title: 'MCP servers',
    summary: 'Connect Claude to external tools and data through the Model Context Protocol.',
    what: 'An MCP server gives Claude tools for a real system: GitHub, a database, Sentry, a design tool. Local servers run as a process on your machine (stdio); remote ones are reached over HTTP. Claude Code stores servers at three scopes: local (default, only you in this project), project (`.mcp.json`, shared through git) and user (you, every project).',
    where: [
      '`.mcp.json` in the project root: project scope, committed',
      '`~/.claude.json`: user scope and local (per-project, private) scope',
      'Plugins: `.mcp.json` at the plugin root',
      'claude.ai connectors you enabled are available automatically when signed in',
    ],
    use: [
      'Use when Claude needs live data or actions it cannot get from files: issues, logs, queries, deployments.',
      'Prefer remote HTTP servers with OAuth (`/mcp` → Sign in) over tokens in config files.',
      'In `.mcp.json`, write credentials as `${VAR}` so the file can be committed safely.',
      'Project servers stay pending until approved in an interactive session.',
    ],
    avoid: [
      'Servers you rarely use: each adds tool definitions; tool search defers most of them, but not all setups support it.',
      'Unknown third-party servers: they run with your permissions.',
    ],
    workflow: [
      'Find a server (the official server list, a plugin in the catalog, or your vendor\'s docs).',
      'Add it: `claude mcp add --transport http <name> <url>` or `claude mcp add <name> -- <command> [args…]`; add `--scope project` to share it.',
      'Authenticate with `/mcp` → the server → Sign in, if it uses OAuth.',
      'Check it with `claude mcp list` (health) and `/mcp` (status and tools).',
    ],
    examples: [
      {
        title: 'A shared .mcp.json with a credential from the environment',
        path: '.mcp.json',
        language: 'json',
        code: `{
  "mcpServers": {
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/mcp"
    },
    "internal-api": {
      "type": "http",
      "url": "\${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": { "Authorization": "Bearer \${INTERNAL_API_TOKEN}" }
    }
  }
}`,
        note: 'Every teammate sets INTERNAL_API_TOKEN in their own environment; nothing secret is committed.',
      },
    ],
    commands: [
      ['claude mcp add --transport http <name> <url>', 'Add a remote server (add --scope project|user)'],
      ['claude mcp add <name> -- <command> [args…]', 'Add a local stdio server; --env KEY=value for variables'],
      ['claude mcp list · get <name> · remove <name>', 'Inspect and manage servers'],
      ['claude mcp add-from-claude-desktop', 'Import servers from Claude Desktop'],
      ['claude mcp reset-project-choices', 'Ask again about project .mcp.json approvals'],
      ['/mcp', 'Status, tools and OAuth sign-in inside a session'],
    ],
    settings: [
      ['enabledMcpjsonServers / disabledMcpjsonServers', 'Approve or reject project servers by name (an explicit disable wins).'],
      ['enableAllProjectMcpServers', 'Approve every server in .mcp.json without asking: convenient, but any repository can add one.'],
      ['MAX_MCP_OUTPUT_TOKENS', 'Environment variable: limit for one tool result (default 25,000).'],
      ['MCP_TIMEOUT', 'Environment variable: server startup timeout in milliseconds.'],
    ],
    gotchas: [
      'Use `--` before the server command so its flags are not read as Claude Code\'s.',
      'Local scope is the default for `claude mcp add`; teammates will not see a local server.',
      'Credential variables such as ANTHROPIC_API_KEY read as empty in remote URLs and headers, to prevent leaks.',
      'SSE transport is deprecated; use HTTP.',
    ],
    troubleshooting: [
      ['"Pending approval" in /mcp', 'Approve it when prompted, or add its name to enabledMcpjsonServers in .claude/settings.local.json.'],
      ['"Needs authentication"', 'Run /mcp, select the server and Sign in; over SSH use `claude mcp login <name> --no-browser`.'],
      ['"Failed to connect"', 'Run the command by hand to see its error, check environment variables, raise MCP_TIMEOUT for slow starts.'],
      ['Too much context used', 'Use Test MCP Server here to measure its tool definitions; remove servers you do not use.'],
    ],
    prompts: [
      {
        id: 'remote',
        label: 'Add a remote HTTP server',
        detail: 'Hosted server with OAuth or a token',
        fields: [
          { key: 'name', label: 'Server name', placeholder: 'sentry' },
          { key: 'url', label: 'Server URL', placeholder: 'https://mcp.sentry.dev/mcp' },
          {
            key: 'auth',
            label: 'How does it authenticate?',
            choices: [
              { label: 'OAuth', value: 'OAuth sign-in through /mcp' },
              { label: 'Token from an environment variable', value: 'a bearer token read from an environment variable with ${VAR} expansion' },
              { label: 'None', value: 'no authentication' },
            ],
          },
          {
            key: 'mcpScope',
            label: 'Scope',
            choices: [
              { label: 'project', value: 'project', detail: '.mcp.json, shared with the team' },
              { label: 'user', value: 'user', detail: 'all your projects' },
              { label: 'local', value: 'local', detail: 'only you, only this project' },
            ],
          },
        ],
        template: framePrompt({
          goal: 'Add the remote MCP server "{{name}}" at {{url}} with scope {{mcpScope}}, authenticating with {{auth}}.',
          inspect: ['Existing MCP servers (claude mcp list and .mcp.json), so the name is unique and it is not already configured.'],
          requirements: [
            'Use claude mcp add --transport http with --scope {{mcpScope}}, or edit .mcp.json for project scope.',
            'No credential value in any file: OAuth, or ${VAR} with the variable name documented for teammates.',
            'For project scope, tell me what each teammate must do once (approve, sign in, set variables).',
          ],
          verify: ['Run claude mcp list, and tell me what /mcp should show once it is connected.'],
        }),
      },
      {
        id: 'stdio',
        label: 'Add a local (stdio) server',
        detail: 'A server that runs as a process',
        fields: [
          { key: 'name', label: 'Server name', placeholder: 'postgres' },
          { key: 'command', label: 'Package or command that starts it', placeholder: 'npx -y @modelcontextprotocol/server-postgres' },
          { key: 'env', label: 'Environment variable names it needs (no values)', placeholder: 'DATABASE_URL', optional: true },
          {
            key: 'mcpScope',
            label: 'Scope',
            choices: [
              { label: 'local', value: 'local', detail: 'only you, only this project' },
              { label: 'project', value: 'project', detail: '.mcp.json, shared with the team' },
              { label: 'user', value: 'user', detail: 'all your projects' },
            ],
          },
        ],
        template: framePrompt({
          goal: 'Add a local MCP server "{{name}}" started with `{{command}}`, scope {{mcpScope}}.',
          inspect: ['The server\'s documentation or --help for required arguments, permissions and what data it can reach.'],
          requirements: [
            'claude mcp add {{name}} --scope {{mcpScope}} -- <command and args>, keeping the -- separator.',
            '{{#env}}It needs {{env}}: reference them as ${VAR} in .mcp.json or via --env, never with real values in a committed file.{{/env}}',
            'If it can write data, recommend the narrowest mode (read-only user, specific database, specific directory).',
          ],
          verify: ['Run claude mcp list and show its tools once it connects.'],
        }),
      },
      {
        id: 'share',
        label: 'Share servers with the team through .mcp.json',
        detail: 'Move a personal server to project scope safely',
        fields: [{ key: 'name', label: 'Which server?', placeholder: 'github' }],
        template: framePrompt({
          goal: 'Move the MCP server "{{name}}" to project scope in .mcp.json so the whole team gets it.',
          inspect: ['Its current definition (claude mcp get {{name}}) and every value in it that is a credential or machine-specific path.'],
          requirements: [
            'Replace credentials and machine-specific paths with ${VAR} or ${VAR:-default}.',
            'Write a short README section or CLAUDE.md note listing the variables teammates must set and that they must approve the server.',
            'Remove the old local or user definition only after the project one works.',
          ],
          verify: ['Show the final .mcp.json with no secret values in it.'],
        }),
      },
    ],
    links: [
      doc('MCP documentation', 'mcp'),
      doc('MCP quickstart', 'mcp-quickstart'),
      { label: 'Reference MCP servers (download)', url: 'https://github.com/modelcontextprotocol/servers', kind: 'download' },
      { label: 'MCP Registry', url: 'https://registry.modelcontextprotocol.io', kind: 'catalog' },
      { label: 'Plugins that bundle MCP servers', url: 'https://claude.com/plugins', kind: 'catalog' },
      { label: 'Model Context Protocol', url: 'https://modelcontextprotocol.io', kind: 'reference' },
    ],
    related: ['plugin', 'setting', 'agent'],
    docs: `${D}/mcp`,
  },

  lsp: {
    title: 'LSP servers',
    summary: 'Code intelligence for Claude: diagnostics after edits and real go-to-definition.',
    what: 'Code intelligence plugins connect Claude Code to a language server. After every edit Claude receives the errors and warnings the server reports, so it notices a broken import or type error in the same turn, and it can jump to definitions, find references and trace calls instead of searching text. The plugin configures the connection; **you install the language server binary yourself**.',
    where: [
      'Plugin `.lsp.json`, or `lspServers` in `plugin.json`',
      'Official plugins: `clangd-lsp`, `csharp-lsp`, `gopls-lsp`, `jdtls-lsp`, `kotlin-lsp`, `lua-lsp`, `php-lsp`, `pyright-lsp`, `rust-analyzer-lsp`, `swift-lsp`, `typescript-lsp`',
    ],
    use: [
      'Use in typed codebases where Claude otherwise guesses at symbols or misses type errors.',
      'Install the binary first, then the plugin; check the `/plugin` Errors tab if it does not start.',
      'Press Ctrl+O when Claude Code reports new diagnostic issues to read them yourself.',
    ],
    avoid: [
      'Very large monorepos where the server uses a lot of memory; disable the plugin and rely on search.',
      'Cloud sessions: plugin language servers are not started there.',
    ],
    workflow: [
      'Install the language server binary for your language and make sure it is on PATH.',
      'Run `/plugin install <plugin>@claude-plugins-official`, for example `pyright-lsp`.',
      'Edit a file and watch for diagnostics; check `/plugin` → Errors if nothing happens.',
    ],
    examples: [
      {
        title: 'Your own LSP plugin for a language without an official one',
        path: '<plugin>/.lsp.json',
        language: 'json',
        code: `{
  "go": {
    "command": "gopls",
    "args": ["serve"],
    "extensionToLanguage": { ".go": "go" }
  }
}`,
      },
    ],
    commands: [
      ['/plugin install pyright-lsp@claude-plugins-official', 'Install a code intelligence plugin'],
      ['npm install -g pyright', 'Python server binary (pyright-langserver)'],
      ['npm install -g typescript-language-server typescript', 'TypeScript server binary'],
      ['go install golang.org/x/tools/gopls@latest', 'Go server binary'],
      ['/plugin disable <plugin>', 'Turn it off if memory use is too high'],
    ],
    gotchas: [
      '`Executable not found in $PATH` in the Errors tab means the binary is missing, not the plugin.',
      'Monorepos can show false unresolved-import diagnostics when the workspace is not configured; they do not stop edits.',
      'An LSP plugin that is delivering diagnostics counts as used, so it is not listed under "Not used recently".',
    ],
    troubleshooting: [
      ['The server does not start', 'Run the binary in a terminal (`pyright-langserver --version`, `gopls version`) to check it is on PATH.'],
      ['High memory use', 'rust-analyzer and pyright can be heavy on large projects; disable the plugin for that project.'],
    ],
    prompts: [
      {
        id: 'install',
        label: 'Set up code intelligence for a language',
        detail: 'Install the binary and the official plugin',
        fields: [
          {
            key: 'language',
            label: 'Which language?',
            choices: [
              { label: 'Python', value: 'Python: install the pyright-langserver binary (pyright), then the pyright-lsp plugin' },
              { label: 'TypeScript / JavaScript', value: 'TypeScript: install typescript-language-server and typescript, then the typescript-lsp plugin' },
              { label: 'Go', value: 'Go: install gopls, then the gopls-lsp plugin' },
              { label: 'Rust', value: 'Rust: install rust-analyzer, then the rust-analyzer-lsp plugin' },
              { label: 'C / C++', value: 'C/C++: install clangd, then the clangd-lsp plugin' },
              { label: 'Java', value: 'Java: install jdtls, then the jdtls-lsp plugin' },
              { label: 'Kotlin', value: 'Kotlin: install kotlin-language-server, then the kotlin-lsp plugin' },
              { label: 'C#', value: 'C#: install csharp-ls, then the csharp-lsp plugin' },
              { label: 'PHP', value: 'PHP: install intelephense, then the php-lsp plugin' },
              { label: 'Lua', value: 'Lua: install lua-language-server, then the lua-lsp plugin' },
              { label: 'Swift', value: 'Swift: use sourcekit-lsp from the Swift toolchain, then the swift-lsp plugin' },
            ],
          },
        ],
        template: framePrompt({
          goal: 'Set up Claude Code code intelligence for {{language}} from the claude-plugins-official marketplace.',
          inspect: [
            'Whether the language server binary is already installed and on PATH, and which package manager this machine uses.',
            'The project\'s configuration the server will read (tsconfig.json, pyproject.toml, go.mod…).',
          ],
          requirements: [
            'Give me the exact install command for the binary for this OS, and run it only after I approve.',
            'Then give me the /plugin install command with the right scope (user unless the team should share it).',
            'Point out project configuration the server needs to resolve imports correctly.',
          ],
          verify: ['Tell me how to confirm it works: the binary version check, the /plugin Installed and Errors tabs, and an edit that should produce a diagnostic.'],
        }),
      },
      {
        id: 'custom-lsp',
        label: 'Create an LSP plugin for another language',
        detail: 'A small plugin with a .lsp.json',
        fields: [
          { key: 'language', label: 'Language', placeholder: 'Elixir' },
          { key: 'server', label: 'Language server command', placeholder: 'elixir-ls' },
          { key: 'extensions', label: 'File extensions', placeholder: '.ex, .exs' },
        ],
        template: framePrompt({
          goal: 'Create a local Claude Code plugin that connects {{language}} files ({{extensions}}) to the {{server}} language server.',
          requirements: [
            'Plugin folder with .claude-plugin/plugin.json and a .lsp.json at the plugin root with command, args and extensionToLanguage.',
            'Explain how to install {{server}} and how to load the plugin with claude --plugin-dir for testing.',
            'Validate it with claude plugin validate.',
          ],
          verify: ['Describe how to check that diagnostics arrive after editing a {{language}} file.'],
        }),
      },
    ],
    links: [
      { label: 'Code intelligence plugins and required binaries', url: `${D}/discover-plugins`, kind: 'docs' },
      doc('LSP server configuration (plugins reference)', 'plugins-reference'),
      { label: 'Pyright (Python)', url: 'https://github.com/microsoft/pyright', kind: 'download' },
      { label: 'typescript-language-server', url: 'https://github.com/typescript-language-server/typescript-language-server', kind: 'download' },
      { label: 'gopls (Go)', url: 'https://go.dev/gopls/', kind: 'download' },
      { label: 'rust-analyzer', url: 'https://rust-analyzer.github.io/manual.html', kind: 'download' },
      { label: 'clangd (C/C++)', url: 'https://clangd.llvm.org/installation', kind: 'download' },
      { label: 'Eclipse JDT Language Server (Java)', url: 'https://github.com/eclipse-jdtls/eclipse.jdt.ls', kind: 'download' },
      { label: 'Kotlin Language Server', url: 'https://github.com/fwcd/kotlin-language-server', kind: 'download' },
      { label: 'csharp-ls (C#)', url: 'https://github.com/razzmatazz/csharp-language-server', kind: 'download' },
      { label: 'Intelephense (PHP)', url: 'https://intelephense.com/', kind: 'download' },
      { label: 'Lua Language Server', url: 'https://luals.github.io/', kind: 'download' },
      { label: 'SourceKit-LSP (Swift)', url: 'https://github.com/swiftlang/sourcekit-lsp', kind: 'download' },
      { label: 'Language Server Protocol', url: 'https://microsoft.github.io/language-server-protocol/', kind: 'reference' },
    ],
    related: ['plugin'],
    docs: `${D}/discover-plugins`,
  },

  plugin: {
    title: 'Plugins',
    summary: 'Bundles of skills, agents, hooks, MCP and LSP servers, installed from marketplaces.',
    what: 'A plugin packages skills, commands, subagents, hooks, MCP servers, LSP servers, output styles, themes and workflows so they install together. Plugins come from marketplaces: Claude Code adds the official Anthropic marketplace (`claude-plugins-official`) automatically, and you can add community, team or local ones. Plugin skills are namespaced, such as `/commit-commands:commit`.',
    where: [
      '`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`: installed copies',
      '`enabledPlugins` in settings: which plugins are on, per scope',
      '`extraKnownMarketplaces` in settings: marketplaces a project or organisation adds',
    ],
    use: [
      'Use to add a whole capability at once: an integration, a review toolkit, code intelligence.',
      'Check the **Context cost** and **Will install** sections in `/plugin` → Discover before installing.',
      'Install at project scope to share with the team through `.claude/settings.json`.',
      'Only install plugins you trust: they run code with your permissions.',
    ],
    avoid: ['Plugins you tried once: the Installed tab lists ones not used recently, and each still costs startup context.'],
    workflow: [
      'Run `/plugin` and open the Discover tab, or browse the online catalog.',
      'Select a plugin, review what it installs and its context cost, choose a scope.',
      'Use it: plugin skills appear as `/plugin-name:skill`.',
      'Manage later in `/plugin` → Installed (enable, disable, uninstall).',
    ],
    examples: [
      {
        title: 'A team marketplace and plugin enabled for everyone in the project',
        path: '.claude/settings.json',
        language: 'json',
        code: `{
  "extraKnownMarketplaces": {
    "my-team-tools": {
      "source": { "source": "github", "repo": "your-org/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "formatter@my-team-tools": true
  }
}`,
      },
    ],
    commands: [
      ['/plugin', 'Discover, Installed, Marketplaces, Errors and Stats tabs'],
      ['/plugin install <name>@claude-plugins-official', 'Install from the official marketplace'],
      ['/plugin marketplace add <owner/repo | url | path>', 'Add a marketplace'],
      ['/plugin enable | disable | uninstall <name>@<marketplace>', 'Manage an installed plugin'],
      ['/reload-plugins', 'Apply plugin changes without restarting'],
      ['claude plugin install <name> --scope project', 'Install from a shell script'],
      ['claude plugin validate <path>', 'Check a plugin you are writing'],
    ],
    settings: [
      ['enabledPlugins', '`{ "name@marketplace": true | false }` per scope.'],
      ['extraKnownMarketplaces', 'Marketplaces added automatically once the folder is trusted.'],
      ['strictKnownMarketplaces', 'Managed: restrict which marketplaces users may add.'],
    ],
    gotchas: [
      'Installed and enabled are separate: a plugin can be installed and switched off.',
      'Removing a marketplace uninstalls the plugins that came from it.',
      'Plugin skills are not affected by `skillOverrides`; manage them through `/plugin`.',
      'The community marketplace (`claude-community`) must be added by hand.',
    ],
    troubleshooting: [
      ['Marketplace "claude-plugins-official" not found', 'Run `/plugin marketplace add anthropics/claude-plugins-official`.'],
      ['Plugin skills do not appear', 'Run `/reload-plugins`; if that fails, `rm -rf ~/.claude/plugins/cache`, restart and reinstall.'],
      ['`/plugin` is not recognised', 'Update Claude Code (`claude --version`, then upgrade) and restart.'],
    ],
    prompts: [
      {
        id: 'install-official',
        label: 'Find and install a plugin',
        detail: 'From the official marketplace, with a review first',
        fields: [{ key: 'need', label: 'What do you need it for?', placeholder: 'GitHub pull requests and issues' }],
        template: framePrompt({
          goal: 'Find a plugin in the claude-plugins-official marketplace for {{need}} and install it.',
          inspect: ['What is already installed (/plugin list) and my MCP servers, so nothing is duplicated.'],
          requirements: [
            'Suggest the best match and at most two alternatives, with what each adds (skills, agents, hooks, MCP servers) and its context cost.',
            'Recommend a scope (user for me, project for the team) and give the exact /plugin install command.',
            'List any setup after install: sign-ins, environment variables, binaries.',
          ],
          verify: ['Tell me which commands or skills to try first to confirm it works.'],
          deliver: 'Present the options and wait for me to choose before installing anything.',
        }),
      },
      {
        id: 'team-marketplace',
        label: 'Add a team marketplace to this project',
        detail: 'extraKnownMarketplaces and enabledPlugins',
        fields: [
          { key: 'repo', label: 'Marketplace repository (owner/repo or git URL)', placeholder: 'your-org/claude-plugins' },
          { key: 'plugins', label: 'Plugins to enable for everyone (optional)', placeholder: 'formatter, deploy-tools', optional: true },
        ],
        template: framePrompt({
          goal: 'Configure this project so every teammate gets the marketplace {{repo}}.',
          requirements: [
            'Add it under extraKnownMarketplaces in .claude/settings.json with the correct source type (github or git).',
            '{{#plugins}}Enable these plugins in enabledPlugins as name@marketplace: {{plugins}}.{{/plugins}}',
            'Explain what teammates see on first run (folder trust, install prompts) and anything they must install themselves.',
          ],
          verify: ['Show the final .claude/settings.json section and how a teammate checks it in /plugin.'],
        }),
      },
      {
        id: 'package-mine',
        label: 'Package my configuration as a plugin',
        detail: 'Turn skills, agents and hooks into one installable plugin',
        fields: [
          { key: 'name', label: 'Plugin name (kebab-case)', placeholder: 'acme-dev-tools' },
          { key: 'include', label: 'What should it include?', placeholder: 'my review skills, the code-reviewer agent and the format hook' },
        ],
        template: framePrompt({
          goal: 'Create a plugin named {{name}} that packages {{include}}.',
          inspect: ['The source files for each item and anything they reference by absolute path.'],
          requirements: [
            'Standard layout: .claude-plugin/plugin.json (name, description, version) and skills/, agents/, hooks/hooks.json at the plugin root.',
            'Rewrite paths in hooks and skills to ${CLAUDE_PLUGIN_ROOT}.',
            'Add a marketplace.json so it can be installed with /plugin marketplace add.',
            'Leave the originals in place until I have tested the plugin.',
          ],
          verify: ['Run claude plugin validate on it and explain how to test with claude --plugin-dir.'],
        }),
      },
    ],
    links: [
      doc('Discover and install plugins', 'discover-plugins'),
      { label: 'Plugin catalog', url: 'https://claude.com/plugins', kind: 'catalog' },
      { label: 'Official marketplace repository', url: 'https://github.com/anthropics/claude-plugins-official', kind: 'download' },
      { label: 'Community marketplace', url: 'https://github.com/anthropics/claude-plugins-community', kind: 'download' },
      { label: 'Demo plugins', url: 'https://github.com/anthropics/claude-code/tree/main/plugins', kind: 'download' },
      doc('Create plugins', 'plugins'),
      doc('Create a marketplace', 'plugin-marketplaces'),
      { label: 'Plugins reference', url: `${D}/plugins-reference`, kind: 'reference' },
    ],
    related: ['skill', 'mcp', 'lsp', 'hook'],
    docs: `${D}/discover-plugins`,
  },

  keybinding: {
    title: 'Keybindings',
    summary: 'Rebind or unbind keyboard shortcuts in the Claude Code terminal UI.',
    what: 'One JSON file with a `bindings` array: each block names a context (Chat, Global, Transcript…) and maps keystrokes to actions such as `chat:externalEditor`. Setting an action to `null` unbinds its key. Changes are picked up without restarting.',
    where: ['`~/.claude/keybindings.json`: user only'],
    use: [
      'Use to resolve a clash with your terminal or multiplexer, or to move an action to a key you prefer.',
      'Add `$schema` to get completion and validation in your editor.',
      'Chords are space-separated keystrokes, such as `ctrl+k ctrl+s`.',
    ],
    workflow: [
      'Run `/keybindings` to create or open the file.',
      'Add a block for the context and map the keystroke to the action (or to `null`).',
      'Save; Claude Code applies it immediately and warns about invalid entries.',
    ],
    examples: [
      {
        title: 'External editor on Ctrl+E, Ctrl+U unbound',
        path: '~/.claude/keybindings.json',
        language: 'json',
        code: `{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+e": "chat:externalEditor",
        "ctrl+u": null
      }
    }
  ]
}`,
      },
    ],
    commands: [
      ['/keybindings', 'Create or open the keybindings file'],
      ['claude --debug', 'Show why a binding was rejected'],
    ],
    gotchas: [
      'Ctrl+C, Ctrl+D, Ctrl+M, Ctrl+[, Ctrl+I, Ctrl+H and Caps Lock cannot be rebound.',
      'Ctrl+B is the tmux prefix and Ctrl+A the GNU screen prefix; Ctrl+Z suspends the process.',
      '`cmd` bindings only work in terminals that report the Super key; prefer `ctrl` or `meta`.',
      'An unknown action name is skipped and the default binding stays.',
    ],
    troubleshooting: [
      ['The binding does nothing', 'Check the context name, the action name, and whether your terminal sends that key combination at all.'],
      ['A chord prefix no longer works alone', 'Unbind every chord that starts with that prefix, in each context that defines one.'],
    ],
    prompts: [
      {
        id: 'rebind',
        label: 'Rebind a shortcut',
        detail: 'Move an action to another key',
        fields: [
          { key: 'action', label: 'Which action?', placeholder: 'open the prompt in an external editor' },
          { key: 'key', label: 'Which key?', placeholder: 'ctrl+e' },
        ],
        template: framePrompt({
          goal: 'Bind {{key}} to the Claude Code action that will {{action}}, in ~/.claude/keybindings.json.',
          inspect: ['The current keybindings file and the keybindings reference, for the exact action name and context.'],
          requirements: [
            'Add $schema if missing; add to the existing context block rather than creating a duplicate one.',
            'Tell me what {{key}} did before, and whether it is reserved or conflicts with tmux or screen.',
          ],
          verify: ['Explain how to test it in a session.'],
        }),
      },
      {
        id: 'terminal-conflict',
        label: 'Resolve a terminal conflict',
        detail: 'tmux, screen or terminal shortcuts',
        fields: [
          {
            key: 'tool',
            label: 'Which tool conflicts?',
            choices: [
              { label: 'tmux', value: 'tmux (prefix Ctrl+B)' },
              { label: 'GNU screen', value: 'GNU screen (prefix Ctrl+A)' },
              { label: 'My terminal app', value: 'my terminal application\'s own shortcuts' },
            ],
          },
        ],
        template: framePrompt({
          goal: 'Make Claude Code\'s shortcuts work alongside {{tool}}.',
          requirements: [
            'List the Claude Code default bindings that collide, and propose replacements that are free in both.',
            'Write them into ~/.claude/keybindings.json, unbinding the old keys with null where needed.',
          ],
        }),
      },
    ],
    links: [
      doc('Keybindings documentation', 'keybindings'),
      { label: 'JSON schema for keybindings.json', url: 'https://www.schemastore.org/claude-code-keybindings.json', kind: 'reference' },
    ],
    related: ['theme', 'setting'],
    docs: `${D}/keybindings`,
  },

  setting: {
    title: 'Settings',
    summary: 'JSON files that configure model, permissions, hooks, environment and more.',
    what: 'Settings are JSON files at several levels with a strict precedence: managed (organisation) > command line (`--settings`) > project local (`.claude/settings.local.json`) > shared project (`.claude/settings.json`) > user (`~/.claude/settings.json`). A value from a higher level wins; lists such as `permissions.allow` are combined across levels. Claude Code also keeps `~/.claude.json` for its own state and MCP servers.',
    where: [
      '`~/.claude/settings.json`: you, every project',
      '`.claude/settings.json`: everyone in the project (committed)',
      '`.claude/settings.local.json`: you, this project (git-ignored)',
      'Managed settings: see the Policy guide',
    ],
    use: [
      'Team conventions (permissions, hooks, plugins) go in `.claude/settings.json`; personal choices in `settings.local.json` or the user file.',
      'Add `"$schema": "https://json.schemastore.org/claude-code-settings.json"` for completion and validation.',
      'Permissions are checked deny → ask → allow; the first match wins, so an allow cannot except a deny.',
      'Run `/status` to see which files loaded, and `claude doctor` for entries that were rejected.',
    ],
    workflow: [
      'Decide who the setting is for: you, the team, or you in this project.',
      'Edit that file (or use `/config`, which writes common options for you).',
      'Run `/status` in Claude Code to confirm the file loaded.',
      'Use **Show Effective Settings** here to see which file supplies each value.',
    ],
    examples: [
      {
        title: 'Shared project settings',
        path: '.claude/settings.json',
        language: 'json',
        code: `{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": ["Bash(npm run test *)", "Bash(npm run lint)"],
    "deny": ["Read(./.env)", "Read(./.env.*)", "Bash(git push *)"]
  },
  "env": { "NODE_ENV": "development" }
}`,
      },
    ],
    commands: [
      ['/config', 'Change common options; Config tab'],
      ['/status', 'Status tab: Setting sources line shows which files loaded'],
      ['/permissions', 'View and edit permission rules'],
      ['claude doctor', 'List settings entries Claude Code rejected'],
      ['claude --settings <file-or-json>', 'Override settings for one session'],
    ],
    settings: [
      ['model', 'Default model, e.g. "opus" or "sonnet".'],
      ['permissions.allow / ask / deny', 'Tool permission rules; lists merge across files.'],
      ['permissions.defaultMode', 'default, acceptEdits, plan, auto, dontAsk, bypassPermissions (auto and bypass not from project files).'],
      ['env', 'Environment variables for sessions.'],
      ['hooks · enabledPlugins · outputStyle · statusLine', 'See the matching guides.'],
      ['cleanupPeriodDays', 'How long transcripts and plans are kept (default 30).'],
    ],
    gotchas: [
      'Strict JSON: a comment or trailing comma makes Claude Code skip the file or its values.',
      '`bypassPermissions` and `auto` as `defaultMode` are ignored in project and local files.',
      'A managed value cannot be overridden; `/status` shows the managed source.',
      'Some keys are only honoured in user, local or managed files; the settings reference lists each key\'s scope.',
    ],
    troubleshooting: [
      ['My value is ignored', 'A higher level sets the same key: check Show Effective Settings or `/status`, then `claude doctor`.'],
      ['The file is reported broken', 'Validate it against the JSON schema; remove comments and trailing commas.'],
      ['A change has no effect yet', 'Some settings apply at startup only; restart the session.'],
    ],
    prompts: [
      {
        id: 'set-correctly',
        label: 'Change a setting in the right place',
        detail: 'Picks the level and checks precedence',
        fields: [
          { key: 'setting', label: 'Which setting or behaviour?', placeholder: 'always start in plan mode' },
          {
            key: 'forWhom',
            label: 'For whom?',
            choices: [
              { label: 'Just me, every project', value: 'just me in every project (~/.claude/settings.json)' },
              { label: 'The whole team', value: 'everyone in this project (.claude/settings.json)' },
              { label: 'Just me, this project', value: 'only me in this project (.claude/settings.local.json)' },
            ],
          },
        ],
        template: framePrompt({
          goal: 'Configure Claude Code so that: {{setting}}, for {{forWhom}}.',
          inspect: [
            'The settings reference for the exact key and which files may set it.',
            'All settings files that apply here, for an existing value at a higher level that would override mine.',
          ],
          requirements: [
            'Edit only the chosen file, keeping it strict JSON, and add $schema if missing.',
            'If the key cannot be set from that file, or a higher level overrides it, tell me instead of writing it.',
          ],
          verify: ['Tell me how to confirm with /status or the behaviour itself.'],
        }),
      },
      {
        id: 'split-team-personal',
        label: 'Separate team and personal settings',
        detail: 'Move personal values out of committed files',
        fields: [],
        template: framePrompt({
          goal: 'Make .claude/settings.json contain only what the whole team should share, and move personal values out.',
          inspect: ['.claude/settings.json, .claude/settings.local.json, ~/.claude/settings.json and .gitignore.'],
          requirements: [
            'Classify every key as team, personal-for-this-project or personal-everywhere, with a one-line reason each.',
            'Move personal values to settings.local.json or the user file; make sure settings.local.json is git-ignored.',
            'Flag anything in a committed file that looks like a secret or a machine-specific path.',
          ],
        }),
      },
      {
        id: 'diagnose',
        label: 'Find out why a setting is ignored',
        detail: 'Precedence, scope and validity',
        fields: [{ key: 'key', label: 'Which setting key?', placeholder: 'permissions.defaultMode' }],
        template: framePrompt({
          goal: 'Explain why the setting {{key}} does not take effect in this project.',
          inspect: [
            'Every settings level (managed, --settings, project local, project, user) for {{key}}.',
            'The settings reference for which files may set {{key}}, and whether it needs a restart.',
          ],
          requirements: ['Name the file whose value wins and why, and whether any file is invalid JSON.'],
          verify: ['Tell me which /status or claude doctor output proves it.'],
          deliver: 'Explain first and propose the smallest fix; do not change files until I agree.',
        }),
      },
    ],
    links: [
      doc('Settings files and precedence', 'settings'),
      { label: 'All settings keys', url: `${D}/settings-reference`, kind: 'reference' },
      doc('Example settings files', 'settings-example'),
      doc('Permissions', 'permissions'),
      doc('Debug your configuration', 'debug-your-config'),
      { label: 'JSON schema for settings.json', url: 'https://json.schemastore.org/claude-code-settings.json', kind: 'reference' },
    ],
    related: ['policy', 'hook', 'plugin', 'mcp'],
    docs: `${D}/settings`,
  },

  policy: {
    title: 'Policy',
    summary: 'Settings your organisation enforces, above every file of yours.',
    what: 'Managed settings are deployed by an administrator as a file, an MDM profile or registry value, or from the claude.ai admin console. They outrank every user, project, local and `--settings` value, and some keys (such as `allowManagedPermissionRulesOnly` or `allowManagedHooksOnly`) are only honoured there.',
    where: [
      'macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`',
      'Linux and WSL: `/etc/claude-code/managed-settings.json`',
      'Windows: `C:\\Program Files\\ClaudeCode\\managed-settings.json`',
      'Drop-ins: `managed-settings.d/*.json` next to it, merged alphabetically',
      'MDM: macOS `com.anthropic.claudecode` domain; Windows `HKLM\\SOFTWARE\\Policies\\ClaudeCode` value `Settings`',
      'Organisation-pushed: `~/.claude/remote-settings.json`, `~/.claude/policy-limits.json` (replaced on sync)',
    ],
    use: [
      'If a setting of yours is ignored, check here first: `/status` names the managed source.',
      'Administrators: start with a file, move to MDM or server-managed settings when deploying widely.',
    ],
    avoid: ['Editing the organisation-pushed files: they are overwritten on the next sync.'],
    workflow: [
      'Run `/status` and read the Setting sources line.',
      'Open the managed file or ask your administrator for the policy.',
      'Use **Show Effective Settings** here to see which values the policy supplies.',
    ],
    examples: [
      {
        title: 'A minimal organisation policy',
        path: 'managed-settings.json',
        language: 'json',
        code: `{
  "permissions": {
    "deny": ["Read(./.env)", "Read(./secrets/**)"],
    "disableBypassPermissionsMode": "disable"
  },
  "strictKnownMarketplaces": ["claude-plugins-official"]
}`,
      },
    ],
    commands: [
      ['/status', 'Shows which managed source applies (file, plist, HKLM…)'],
      ['claude doctor', 'Entries dropped from a managed source'],
    ],
    gotchas: [
      'A managed file that is not valid JSON stops Claude Code from starting, with an error naming the source.',
      'MDM policies are re-read every 30 minutes.',
      'A local administrator can edit the managed file itself; enforcement relies on your device management.',
    ],
    prompts: [
      {
        id: 'explain',
        label: 'Explain what my organisation enforces',
        detail: 'Read-only overview of the managed policy',
        fields: [],
        template: framePrompt({
          goal: 'Explain what my organisation\'s managed Claude Code policy enforces on this machine.',
          inspect: ['The managed settings sources for this OS, drop-ins, and ~/.claude/remote-settings.json if present.'],
          requirements: [
            'Summarise each enforced key in plain words and which of my own settings it overrides.',
            'Point out anything that explains behaviour I might find surprising (blocked tools, disabled modes, restricted marketplaces).',
          ],
          deliver: 'Do not change any files; this is an explanation only.',
        }),
      },
      {
        id: 'draft',
        label: 'Draft a managed policy for a team',
        detail: 'For administrators',
        fields: [{ key: 'requirements', label: 'What must be enforced?', placeholder: 'no reading .env files, only the official marketplace, no bypass mode' }],
        template: framePrompt({
          goal: 'Draft a managed-settings.json that enforces: {{requirements}}.',
          inspect: ['The managed settings documentation for keys that only work in managed settings and for how sources combine.'],
          requirements: [
            'Use the narrowest keys that achieve each requirement, with a comment in your answer (not in the JSON) explaining each.',
            'Say how to deploy it per OS (file path, MDM domain or registry key) and how a developer verifies it with /status.',
          ],
          deliver: 'Show the JSON and deployment notes; do not write to system directories.',
        }),
      },
    ],
    links: [
      doc('Deploy managed settings', 'managed-settings'),
      doc('Server-managed settings', 'server-managed-settings'),
      { label: 'MDM deployment templates (Jamf, Intune, Group Policy)', url: 'https://github.com/anthropics/claude-code/tree/main/examples/mdm', kind: 'download' },
    ],
    related: ['setting'],
    docs: `${D}/managed-settings`,
  },

  plan: {
    title: 'Plans',
    summary: 'The plan file plan mode writes, and project folders that keep plans.',
    what:
      "Two unrelated things share this name. `~/.claude/plans/` is Claude Code's own store: in plan " +
      'mode Claude researches without editing, writes a plan to a file on disk, and asks you to ' +
      'approve it before it may touch anything. That file is not a transcript: Claude Code ' +
      '**re-injects it from disk after every compaction**, so the plan survives when the ' +
      'conversation history does not, and editing the file mid-session changes what Claude is ' +
      'working from. A `plans/` folder inside a project is a different thing entirely: no official ' +
      'page reads it, so where one exists it is a team convention, not a Claude Code feature.',
    where: [
      '`~/.claude/plans/`: the default store. Flat, and shared across **every** project.',
      'Filenames are generated: your prompt slugged, plus two random words (`fix-auth-race-snug-otter.md`).',
      '`<project>/.claude/plans/`: only a convention. Claude Code writes there only if `plansDirectory` says so.',
      '`plansDirectory` resolves **relative to the project root**; a path resolving outside it is ignored and the default is kept.',
    ],
    use: [
      'Use it before any change large enough that doing it wrong costs more than planning it.',
      'Read the plan before approving. `Ctrl+G` opens it in your editor so you can change it first.',
      'A plan is also the cheapest handover artifact you have: it says why, not just what.',
      'There is no plan browser, no reuse, no library. Plans are files; treat them as such.',
    ],
    workflow: [
      'Enter with `Shift+Tab`, or `/plan`, or `/plan <task>` to enter and start immediately. From the CLI: `claude --permission-mode plan`.',
      'Claude reads files and runs read-only commands, and writes the plan to disk. Edits stay blocked.',
      'Press `Ctrl+G` to open the proposed plan in your editor and change it before approving.',
      'Approve with **Yes, and use auto mode**, or **Yes, manually approve edits**, or reject with **No, keep planning** and say what to change.',
      '`Shift+Tab` again leaves plan mode without approving anything.',
    ],
    commands: [
      ['Shift+Tab', 'Cycle permission modes, including plan'],
      ['/plan [task]', 'Enter plan mode, optionally starting a task'],
      ['claude --permission-mode plan', 'Start a session in plan mode'],
      ['Ctrl+G', 'Open the plan in your editor'],
    ],
    settings: [
      ['plansDirectory', 'Where plan files are written. Relative to the project root; settable in any settings file. Unset means `~/.claude/plans`.'],
      ['cleanupPeriodDays', 'How long files under `~/.claude/` survive. Default 30, and the plan store is on that list.'],
      ['permissions.defaultMode', 'Set to `plan` to start every session of a project in plan mode.'],
      ['useAutoModeDuringPlan', 'Default true. Lets the classifier vet shell commands during planning instead of prompting. User/local/managed only: a repository cannot turn it off for you.'],
      ['showClearContextOnPlanAccept', 'Default false. Adds an approval option that clears the conversation and implements from the plan alone, useful when planning ate the context window.'],
    ],
    gotchas: [
      '**Plan files are deleted automatically.** Anything under `~/.claude/` older than `cleanupPeriodDays` (default 30) is removed, and `~/.claude/plans/` is explicitly on that list. Nothing warns you, which is why the rows here carry an expiry countdown.',
      '**`<project>/.claude/plans/` is not official.** No Claude Code page reads it. If your team relies on it, only the team enforces it.',
      '**`plansDirectory` cannot point outside the project.** No absolute paths, no `~`, no vault outside the repo. The documented example is `"./plans"`.',
      'In an **interactive terminal where bypass permissions are available**, plan mode does not actually block edits: Claude is only instructed not to. The blocks are real in `-p` runs, the Agent SDK, and the VS Code chat panel.',
      'Each conversation gets its own plan file: `/clear` starts a fresh one, and a `/fork` no longer shares the original.',
      'Approving a plan names the session after it, unless you already named it.',
      'The VS Code extension does not read a project’s `defaultMode` for its starting mode; set `claudeCode.initialPermissionMode` in your VS Code settings instead.',
    ],
    troubleshooting: [
      ['A plan file disappeared', 'It passed `cleanupPeriodDays`; copy plans worth keeping into the project, or set `plansDirectory`.'],
      ['Plans are not written where expected', '`plansDirectory` must resolve inside the project root, otherwise the default store is used.'],
    ],
    prompts: [
      {
        id: 'keep',
        label: 'Keep a plan permanently',
        detail: 'Copy it out of the auto-deleted store',
        fields: [
          { key: 'which', label: 'Which plan? (title or file name)', placeholder: 'the auth race condition plan' },
          { key: 'dest', label: 'Where should it live?', placeholder: 'docs/plans/' },
        ],
        template: framePrompt({
          goal: 'Save the plan "{{which}}" from ~/.claude/plans into {{dest}} so it is not deleted by cleanupPeriodDays.',
          inspect: ['~/.claude/plans for the matching file (by its # heading), and the naming style of files already in {{dest}}.'],
          requirements: [
            'Give it a readable file name that matches the folder\'s convention.',
            'Add a two-sentence summary at the top: what it was about and whether it was implemented.',
            'Leave the original in place.',
          ],
        }),
      },
      {
        id: 'plans-directory',
        label: 'Store this project\'s plans in the repository',
        detail: 'Configure plansDirectory',
        fields: [{ key: 'dir', label: 'Folder inside the project', placeholder: './docs/plans', default: './plans' }],
        template: framePrompt({
          goal: 'Make Claude Code write this project\'s plan files to {{dir}} instead of ~/.claude/plans.',
          requirements: [
            'Set plansDirectory to {{dir}} in the right settings file (shared if the team wants plans in git, local otherwise), and explain the choice.',
            'The path must resolve inside the project root; create the folder with a short README explaining what is kept there.',
            'Tell me whether the folder should be committed or git-ignored.',
          ],
          verify: ['Explain how to check the next plan lands in {{dir}}.'],
        }),
      },
    ],
    links: [doc('Plan mode and other permission modes', 'permission-modes'), doc('The .claude directory', 'claude-directory')],
    related: ['setting', 'memory'],
    docs: `${D}/permission-modes`,
  },

  memory: {
    title: 'Memory',
    summary: 'CLAUDE.md instructions and the auto-memory notes Claude keeps for a project.',
    what: 'Instructions Claude loads before you say anything. `CLAUDE.md` files are yours: user-level for every project, project-level for the team, `CLAUDE.local.md` for private notes. Auto memory is Claude\'s: notes it writes about a project in `~/.claude/projects/<project>/memory/`, with a `MEMORY.md` index of which the first 200 lines or 25 KB load.',
    where: [
      '`~/.claude/CLAUDE.md`: every project',
      '`CLAUDE.md` or `.claude/CLAUDE.md`: this project, shared',
      '`CLAUDE.local.md`: this project, only you (git-ignore it)',
      'Parent folders\' CLAUDE.md files load too; subfolders\' load when Claude works there',
      '`~/.claude/projects/<project>/memory/`: auto memory',
    ],
    use: [
      'Write down what you would otherwise re-explain: build commands, conventions, pitfalls, decisions.',
      'Keep each CLAUDE.md under about 200 lines; everything in it costs context on every request.',
      'Import other files with `@path/to/file` (up to four hops); imports still load at launch.',
      'Block-level `<!-- comments -->` are stripped before loading: use them for notes to humans.',
    ],
    avoid: [
      'Procedures for specific tasks: a skill loads only when needed.',
      'Instructions for some files only: a path-scoped rule.',
      'Anything that must be enforced: a hook or a permission rule.',
    ],
    workflow: [
      'Run `/init` in a project to generate a starting CLAUDE.md, then trim it.',
      'Add what Claude cannot learn from the code: why things are the way they are, commands, gotchas.',
      'Run `/context` to see which memory files loaded, and `/memory` to open them.',
      'Review periodically for contradictions and stale facts.',
    ],
    examples: [
      {
        title: 'A focused project CLAUDE.md',
        path: 'CLAUDE.md',
        language: 'markdown',
        code: `# Acme API

## Commands
- \`npm run dev\`: API on :3000 (needs \`docker compose up db\`)
- \`npm test -- path/to/file\`: run one test file

## Conventions
- Handlers live in src/api/handlers; one file per resource.
- Errors: throw ApiError from src/api/errors.ts, never plain Error.

## Gotchas
- The billing module talks to the sandbox gateway unless NODE_ENV=production.

See @docs/architecture.md for the module map.`,
      },
    ],
    commands: [
      ['/init', 'Generate or improve a project CLAUDE.md'],
      ['/memory', 'Open memory files; toggle auto memory'],
      ['/context', 'See what loaded into the context window'],
    ],
    settings: [
      ['autoMemoryEnabled', 'Turn auto memory on or off (per project if set in project settings).'],
      ['autoMemoryDirectory', 'Store auto memory elsewhere (absolute path or ~/).'],
      ['claudeMdExcludes', 'Glob patterns on absolute paths of CLAUDE.md files and rules to skip.'],
    ],
    gotchas: [
      'All CLAUDE.md files concatenate, root first; closer files are read last, so they take precedence in practice.',
      'Imports outside the project need a one-time approval; decline and they stay disabled.',
      'CLAUDE.md is guidance delivered as a user message, not a hard rule.',
      'Claude Code reads `CLAUDE.md`, not `AGENTS.md`; import it with `@AGENTS.md` if you have one.',
    ],
    troubleshooting: [
      ['Claude ignores an instruction', 'Check `/context` shows the file; make the instruction specific; look for a contradicting one in another file.'],
      ['Instructions vanish after /compact', 'Project-root CLAUDE.md is re-injected; nested files and path rules reload only when matching files are read.'],
      ['Too much context at startup', 'Use the Context budget in the Overview and move file-specific parts into rules.'],
    ],
    prompts: [
      {
        id: 'project-claude-md',
        label: 'Create or improve the project CLAUDE.md',
        detail: 'From the code, kept short',
        fields: [],
        template: framePrompt({
          goal: 'Create or improve this project\'s CLAUDE.md so it holds exactly what Claude cannot learn from the code.',
          inspect: ['Build and dependency files, scripts, CI configuration, the directory layout, and any existing CLAUDE.md, CLAUDE.local.md, AGENTS.md or rules.'],
          requirements: [
            'Sections: Commands (build, test one file, lint, run), Conventions that differ from defaults, Gotchas, and pointers (@imports) to longer docs.',
            'Under 200 lines; cut generic advice, directory listings and anything obvious from the code.',
            'Move instructions that apply only to some files into .claude/rules/ with paths:, and say so.',
          ],
          verify: ['Tell me how to check it with /context.'],
        }),
      },
      {
        id: 'record-fact',
        label: 'Record a fact at the right level',
        detail: 'User, project, local or a rule',
        fields: [{ key: 'fact', label: 'What should Claude remember?', placeholder: 'the integration tests need a local Redis on 6380' }],
        template: framePrompt({
          goal: 'Record this so Claude remembers it in future sessions: "{{fact}}".',
          inspect: ['~/.claude/CLAUDE.md, the project CLAUDE.md and CLAUDE.local.md, and .claude/rules, for where it fits and whether it is already there.'],
          requirements: [
            'Choose the level: user (applies to all my projects), project (the team needs it), local (only me, here), or a path-scoped rule (only some files).',
            'Phrase it as one short, concrete instruction in the section where it belongs.',
          ],
          deliver: 'Tell me which level you chose and why, show the exact line, and wait for my approval.',
        }),
      },
      {
        id: 'audit',
        label: 'Audit memory for size and contradictions',
        detail: 'Shorter, consistent instructions',
        fields: [],
        template: framePrompt({
          goal: 'Audit every memory file that loads in this project for size, duplication and contradictions.',
          inspect: ['User, parent-folder, project and local CLAUDE.md files, their @imports, rules without paths:, and the auto-memory MEMORY.md.'],
          requirements: [
            'Estimate tokens per file (characters ÷ 4) and flag files over 200 lines and a MEMORY.md over 200 lines or 25 KB.',
            'List instructions that contradict or duplicate each other, with which one should win.',
            'Propose cuts and moves (to rules or skills) with the estimated saving.',
          ],
          deliver: 'Report first; change files only for the items I approve.',
        }),
      },
    ],
    links: [doc('Memory documentation', 'memory'), doc('What loads into the context window', 'context-window'), doc('The .claude directory', 'claude-directory')],
    related: ['rule', 'skill', 'setting'],
    docs: `${D}/memory`,
  },
};

// --- prompt templates ------------------------------------------------------------------------

/** The `{{key}}` names a template uses, block markers included. */
export function templateKeys(template: string): Set<string> {
  return new Set([...template.matchAll(/\{\{[#/]?([A-Za-z][A-Za-z0-9_]*)\}\}/g)].map((m) => m[1]));
}

/**
 * Fill a template. `{{#key}}…{{/key}}` is kept only when `key` has a non-empty value, and a
 * list line left empty by a removed block is dropped with it.
 */
export function fillPrompt(template: string, values: Readonly<Record<string, string | undefined>>): string {
  const withBlocks = template.replace(/\{\{#([A-Za-z][A-Za-z0-9_]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key: string, inner: string) =>
    values[key]?.trim() ? inner : '',
  );
  const filled = withBlocks.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (whole, key: string) => values[key]?.trim() ?? whole);
  return filled
    .split('\n')
    .filter((line) => !/^\s*(?:\d+\.|-)\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** Renumber numbered lists after blocks were removed, so "1. 3. 4." reads "1. 2. 3.". */
function renumber(text: string): string {
  let n = 0;
  return text
    .split('\n')
    .map((line) => {
      const m = /^(\d+)\. /.exec(line);
      if (!m) {
        n = 0;
        return line;
      }
      n++;
      return `${n}. ${line.slice(m[0].length)}`;
    })
    .join('\n');
}

/** Fill, then renumber; what the wizard hands to Claude. */
export function renderPrompt(prompt: GuidePrompt, values: Readonly<Record<string, string | undefined>>): string {
  return renumber(fillPrompt(prompt.template, values));
}

/** The prompt as shown in the guide: every field left as `<its label>`. */
export function promptPreview(prompt: GuidePrompt): string {
  const values: Record<string, string> = {
    scopeLabel: '<scope>',
    surfaceDir: '<folder>',
  };
  for (const f of prompt.fields) {
    values[f.key] = f.choices ? `<${f.choices.map((c) => c.label).join(' | ')}>` : `<${f.label.replace(/\?$/, '').replace(/\s*\(.*\)$/, '').toLowerCase()}>`;
  }
  return renderPrompt(prompt, values);
}

// --- rendering ---------------------------------------------------------------------------------

export function renderGuide(kind: AssetKind): string {
  const g = GUIDES[kind];
  const lines: string[] = [`# ${g.title}`, '', `_${g.summary}_`, '', '## What it is', '', g.what, '', '## Where it lives', '', ...g.where.map((w) => `- ${w}`)];

  lines.push('', '## When to use it', '', ...g.use.map((u) => `- ${u}`));
  if (g.avoid?.length) {
    lines.push('', '### When not to', '', ...g.avoid.map((a) => `- ${a}`));
  }
  if (g.workflow?.length) {
    lines.push('', '## Getting started', '', ...g.workflow.map((w, i) => `${i + 1}. ${w}`));
  }
  for (const ex of g.examples ?? []) {
    lines.push('', `## Example: ${ex.title}`, '');
    if (ex.path) {
      lines.push(`\`${ex.path}\``, '');
    }
    lines.push(`\`\`\`${ex.language}`, ex.code, '```');
    if (ex.note) {
      lines.push('', ex.note);
    }
  }
  if (g.commands?.length) {
    lines.push('', '## Commands', '', '| Command | What it does |', '|---|---|', ...g.commands.map(([c, d]) => `| \`${cell(c)}\` | ${cell(d)} |`));
  }
  if (g.settings?.length) {
    lines.push('', '## Settings that govern it', '', '| Key | What it does |', '|---|---|', ...g.settings.map(([k, v]) => `| \`${cell(k)}\` | ${cell(v)} |`));
  }
  if (g.gotchas?.length) {
    lines.push('', '## Worth knowing', '', ...g.gotchas.map((x) => `- ${x}`));
  }
  if (g.troubleshooting?.length) {
    lines.push('', '## Troubleshooting', '', '| Symptom | What to do |', '|---|---|', ...g.troubleshooting.map(([s, f]) => `| ${cell(s)} | ${cell(f)} |`));
  }

  lines.push(
    '',
    '## Prompts you can paste',
    '',
    'Each prompt makes Claude inspect first, follow the documented rules, and show you the change before writing. ' +
      'Replace the `<…>` parts, or right-click the group in the sidebar → **Ask Claude Code** → **Setup Prompt…** to fill them in and copy the prompt or send it to Claude Code.',
  );
  for (const p of g.prompts) {
    lines.push('', `### ${p.label}`, '', `_${p.detail}_`, '', '```text', promptPreview(p), '```');
  }

  const downloads = g.links.filter((l) => l.kind === 'download' || l.kind === 'catalog');
  const reading = g.links.filter((l) => l.kind === 'docs' || l.kind === 'reference');
  lines.push('', '## Get it and learn more');
  if (downloads.length) {
    lines.push('', '**Download & catalogs**', '', ...downloads.map((l) => `- [${l.label}](${l.url})`));
  }
  if (reading.length) {
    lines.push('', '**Documentation**', '', ...reading.map((l) => `- [${l.label}](${l.url})`));
  }
  if (g.related?.length) {
    lines.push('', `**See also:** ${g.related.map((k) => GUIDES[k]?.title ?? ASSET_LABELS[k]).join(' · ')}`);
  }
  lines.push('', '---', '', `Official documentation: ${g.docs}`);
  return lines.join('\n');
}

/** Table cells cannot contain a raw pipe. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}
