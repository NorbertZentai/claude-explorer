import { SkillOverride, Toggle } from '../discovery/types';
import { parseStrict, setValue } from './jsonText';

/**
 * The new file text after flipping one switch. A file that is not valid JSON is refused,
 * never rewritten.
 */
export function toggledText(original: string, toggle: Toggle, enable: boolean): string {
  const settings = parseStrict(original, toggle.file);

  if (toggle.target === 'plugin') {
    return setValue(original, ['enabledPlugins', toggle.key], enable);
  }
  if (toggle.target === 'skill') {
    return skillOverrideText(original, toggle.key, enable ? 'on' : 'off');
  }
  if (toggle.target === 'claudeMd') {
    const excludes = stringList(settings.claudeMdExcludes);
    const next = enable ? excludes.filter((p) => p !== toggle.key) : excludes.includes(toggle.key) ? excludes : [...excludes, toggle.key];
    if (next.length === excludes.length) {
      return original;
    }
    return setValue(original, ['claudeMdExcludes'], next);
  }

  // An explicit disable always wins in Claude Code, so enabling must also remove it there.
  const enabled = stringList(settings.enabledMcpjsonServers);
  const disabled = stringList(settings.disabledMcpjsonServers);
  const without = (list: string[]): string[] => list.filter((name) => name !== toggle.key);
  const nextEnabled = enable ? [...without(enabled), toggle.key] : without(enabled);
  const nextDisabled = enable ? without(disabled) : [...without(disabled), toggle.key];
  let text = original;
  // Only write a list that exists already or has something to say.
  if (settings.enabledMcpjsonServers !== undefined || nextEnabled.length > 0) {
    text = setValue(text, ['enabledMcpjsonServers'], nextEnabled);
  }
  if (settings.disabledMcpjsonServers !== undefined || nextDisabled.length > 0) {
    text = setValue(text, ['disabledMcpjsonServers'], nextDisabled);
  }
  return text;
}

/** Set one skill's `skillOverrides` state; `on` is the default, so it removes the entry. */
export function skillOverrideText(original: string, key: string, state: SkillOverride): string {
  const settings = parseStrict(original, 'This settings file');
  const overrides = settings.skillOverrides;
  const existing = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? (overrides as Record<string, unknown>) : undefined;
  if (state === 'on') {
    if (!existing || !(key in existing)) {
      return original;
    }
    return Object.keys(existing).length === 1
      ? setValue(original, ['skillOverrides'], undefined)
      : setValue(original, ['skillOverrides', key], undefined);
  }
  if (overrides !== undefined && !existing) {
    throw new Error('skillOverrides in this settings file is not an object, so it was left untouched.');
  }
  return setValue(original, ['skillOverrides', key], state);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
