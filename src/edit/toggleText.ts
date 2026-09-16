import { Toggle } from '../discovery/types';
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

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
