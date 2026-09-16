/**
 * One shape for every prompt the extension hands to Claude Code, because the same shape is
 * what gets consistent results: say the goal, make Claude look before it acts, spell out the
 * documented rules it must follow, fence in what it may touch, say how to prove it worked,
 * and ask for a plan before any write.
 *
 * Sections are separated by blank lines. That reads well when pasted; when the prompt is
 * sent to a terminal, `claudeCommandLine()` folds it onto one line.
 */

export interface PromptParts {
  /** One sentence. */
  goal: string;
  /** What to read or check before proposing anything. */
  inspect?: string[];
  /** Numbered requirements, including the documented rules that apply. */
  requirements?: string[];
  /** Extra limits for this task; the standard ones are always added. */
  constraints?: string[];
  /** How to confirm the result, preferably with a Claude Code command. */
  verify?: string[];
  /** Replaces the default delivery instruction, e.g. for read-only tasks. */
  deliver?: string;
}

const STANDARD_CONSTRAINTS = [
  'Never print, copy or write secret values; refer to environment variables by name.',
  'Touch only the files this task needs, and ask before changing anything else.',
];

export const DELIVER_WITH_APPROVAL =
  'Show me the plan and the exact file contents or diff first, and wait for my approval before writing. Afterwards, summarise what changed and how I can test it.';

export const DELIVER_READ_ONLY = 'Do not change any files. Answer concisely, with file references where they help.';

export function framePrompt(parts: PromptParts): string {
  const sections: string[] = [`Goal: ${parts.goal}`];
  if (parts.inspect?.length) {
    sections.push(['Before proposing anything, inspect:', ...parts.inspect.map((i) => `- ${i}`)].join('\n'));
  }
  if (parts.requirements?.length) {
    sections.push(['Requirements:', ...parts.requirements.map((r, i) => `${i + 1}. ${r}`)].join('\n'));
  }
  const constraints = [...(parts.constraints ?? []), ...STANDARD_CONSTRAINTS];
  sections.push(['Constraints:', ...constraints.map((c) => `- ${c}`)].join('\n'));
  if (parts.verify?.length) {
    sections.push(['Verify:', ...parts.verify.map((v) => `- ${v}`)].join('\n'));
  }
  sections.push(`Deliver: ${parts.deliver ?? DELIVER_WITH_APPROVAL}`);
  return sections.join('\n\n');
}
