import { Toggle } from '../discovery/types';
import { applyJsonEdit } from './jsonFile';
import { toggledText } from './toggleText';

/**
 * Flip one documented switch:
 *
 *   plugin       `enabledPlugins["name@marketplace"]` in ~/.claude/settings.json
 *   MCP server   `enabledMcpjsonServers` / `disabledMcpjsonServers` in the project's
 *                .claude/settings.local.json (an explicit disable always wins)
 */
export async function setEnabled(toggle: Toggle, enable: boolean): Promise<void> {
  await applyJsonEdit(toggle.file, (text) => toggledText(text, toggle, enable));
}
