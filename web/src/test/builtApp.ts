import { readFileSync } from "node:fs";
import { join } from "node:path";

import { inject } from "vitest";

// The real app, built once for the whole run (builtApp.setup.ts, the global
// setup of the unit project) and read by the tests that look at the build:
// build.test.ts at its files, lookFailure.test.ts in a browser. A build takes a
// second or two and a lot of the machine's attention: two tests that each
// made their own did it twice, under the load of the whole suite.

/** A part of the build (JS), with what Vite knows of it. */
export type BuiltChunk = {
  type: "chunk";
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  moduleIds: readonly string[];
  /** The parts it imports, statically: the browser loads them with it. */
  imports: readonly string[];
  code: string;
  /** The stylesheets of its modules, as Vite emits them. */
  viteMetadata?: { importedCss: ReadonlySet<string> };
};

/** A file of the build that is not a part: a page, a sheet, a face. */
export type BuiltAsset = { type: "asset"; fileName: string; source: string | Uint8Array };

/** What the global setup writes next to the build, to say what the files of the bundle are. */
export type BuiltManifest = {
  chunks: {
    fileName: string;
    isEntry: boolean;
    facadeModuleId: string | null;
    moduleIds: string[];
    imports: string[];
    importedCss: string[];
  }[];
  assets: string[];
};

declare module "vitest" {
  export interface ProvidedContext {
    /** The folder where the global setup built the app. */
    builtApp: string;
  }
}

/** The files that are read as text: a page, a sheet, a manifest. */
const TEXT = /\.(html|css|svg|json|webmanifest|txt)$/;

let cached: Map<string, BuiltChunk | BuiltAsset> | undefined;

/** The files of the build of the app by their names (`index.html`, `assets/index-….js`). */
export function builtApp(): Map<string, BuiltChunk | BuiltAsset> {
  if (cached !== undefined) return cached;
  const dir = inject("builtApp");
  const manifest: BuiltManifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const files = new Map<string, BuiltChunk | BuiltAsset>();
  for (const chunk of manifest.chunks) {
    files.set(chunk.fileName, {
      type: "chunk",
      fileName: chunk.fileName,
      isEntry: chunk.isEntry,
      facadeModuleId: chunk.facadeModuleId,
      moduleIds: chunk.moduleIds,
      imports: chunk.imports,
      code: readFileSync(join(dir, chunk.fileName), "utf8"),
      viteMetadata: { importedCss: new Set(chunk.importedCss) },
    });
  }
  for (const fileName of manifest.assets) {
    const path = join(dir, fileName);
    files.set(fileName, {
      type: "asset",
      fileName,
      source: TEXT.test(fileName) ? readFileSync(path, "utf8") : readFileSync(path),
    });
  }
  cached = files;
  return files;
}

/** The text of a file of the build, empty when it is not there. */
export function textOfBuilt(fileName: string): string {
  const file = builtApp().get(fileName);
  if (file === undefined) return "";
  const body = file.type === "chunk" ? file.code : file.source;
  return typeof body === "string" ? body : Buffer.from(body).toString("utf8");
}
