import { expect, test } from "vitest";

import { claudeCommand } from "./command";

// A made-up token of the shape of the real ones (ptd_, an id, a secret).
const TOKEN = "ptd_abcdefghij12345_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

test("claudeCommand — la commande de Claude Code, avec --scope user et l'en-tête", () => {
  expect(claudeCommand("https://prends-ton-dossard.example.test/mcp", TOKEN)).toBe(
    `claude mcp add --transport http --scope user prends-ton-dossard https://prends-ton-dossard.example.test/mcp --header "Authorization: Bearer ${TOKEN}"`,
  );
});

test("claudeCommand — le jeton va dans la configuration de la personne, jamais dans le .mcp.json d'un projet", () => {
  const command = claudeCommand("http://localhost:5173/mcp", TOKEN);

  // `--scope user` writes to ~/.claude.json; the default scope (local) and
  // `--scope project` (.mcp.json, which ends up in a repository) would not.
  expect(command).toContain(" --scope user ");
  expect(command).not.toContain("--scope project");
  expect(command).not.toContain(".mcp.json");
});
