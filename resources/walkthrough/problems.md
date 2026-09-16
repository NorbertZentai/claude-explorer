# Catch what is quietly broken

Rows with a warning icon float to the top of their group. Typical finds:

- a hook pointing at a script that no longer exists
- an MCP server defined in `.mcp.json` but never approved
- a plugin that is installed but not enabled
- a skill without a description, which Claude can never trigger
- a settings file that is not strict JSON

Dimmed rows marked **overridden** are not broken: another skill, command or subagent with the same name wins, so this one never runs.
