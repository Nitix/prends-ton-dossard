import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TestProject } from "vitest/node";

import type { BuiltManifest } from "./builtApp";

// The global setup of the unit project: the real app, built as `pnpm build`
// builds it (vite.config.ts), once for the run, into a folder of its own. The
// tests that look at the build read it through builtApp.ts; none builds again.

const web = fileURLToPath(new URL("../../", import.meta.url));

type Output = {
  type: "chunk" | "asset";
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  moduleIds?: string[];
  imports?: string[];
  viteMetadata?: { importedCss: Set<string> };
};

export default async function setup(project: TestProject): Promise<() => void> {
  const dir = mkdtempSync(join(tmpdir(), "ptd-built-"));
  const { build } = await import("vite");
  const result = await build({
    root: web,
    configFile: `${web}vite.config.ts`,
    logLevel: "silent",
    // Not the folder of the server: nothing of the run touches what the program embeds.
    build: { outDir: dir, emptyOutDir: true },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) =>
    "output" in one ? (one.output as Output[]) : [],
  );
  const manifest: BuiltManifest = {
    chunks: outputs
      .filter((file) => file.type === "chunk")
      .map((chunk) => ({
        fileName: chunk.fileName,
        isEntry: chunk.isEntry ?? false,
        facadeModuleId: chunk.facadeModuleId ?? null,
        moduleIds: chunk.moduleIds ?? [],
        imports: chunk.imports ?? [],
        importedCss: [...(chunk.viteMetadata?.importedCss ?? [])],
      })),
    assets: outputs.filter((file) => file.type === "asset").map((asset) => asset.fileName),
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  project.provide("builtApp", dir);
  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
}
