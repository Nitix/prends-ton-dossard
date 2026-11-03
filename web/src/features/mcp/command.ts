/**
 * The command that adds the site's MCP server to Claude Code, with the token
 * of the member in its header.
 *
 * `--scope user` puts the token in the configuration of the user
 * (`~/.claude.json`) and never in the `.mcp.json` of a project, which often ends
 * up in a repository. The address and the token are made of characters that a
 * shell does not touch (a token is `ptd_`, letters and digits, `_` and `-`), so
 * nothing needs quoting but the header.
 */
export function claudeCommand(url: string, token: string): string {
  return `claude mcp add --transport http --scope user prends-ton-dossard ${url} --header "Authorization: Bearer ${token}"`;
}
