import { expect, test } from "vitest";

// @ts-expect-error a script in plain JavaScript
import { filesToRerun, mergeReports } from "../../../tools/ci/cold-cache.mjs";
// @ts-expect-error a script in plain JavaScript
import * as tool from "../../../tools/ci/vitest-annotate.mjs";

const { annotations, escapeData, failures, flaky, flakyAnnotations, flakyTitle, silentFailure } =
  tool;

const report = {
  testResults: [
    {
      name: "/repo/web/src/a.test.tsx",
      status: "failed",
      assertionResults: [
        {
          status: "failed",
          fullName: "A — fait 100 % ça",
          location: { line: 12 },
          failureMessages: ["\u001b[31mAssertionError: expected 1 to be 2\u001b[39m\n at x"],
        },
        { status: "passed", fullName: "A — passe", failureMessages: [] },
      ],
    },
    {
      name: "/repo/web/src/b.test.tsx",
      status: "failed",
      assertionResults: [],
      message: "import failed\nmore",
    },
    { name: "/repo/web/src/c.test.tsx", status: "passed", assertionResults: [] },
  ],
};

test("failures — one entry per failing test, and per file that did not run", () => {
  expect(failures(report, "/repo")).toEqual([
    {
      file: "web/src/a.test.tsx",
      name: "A — fait 100 % ça",
      line: 12,
      message: "AssertionError: expected 1 to be 2",
    },
    { file: "web/src/b.test.tsx", name: "(le fichier)", line: 1, message: "import failed" },
  ]);
});

test("annotations — the list in one error with %0A, then one per file", () => {
  const out = annotations(failures(report, "/repo"), "Tests en échec");
  expect(out).toHaveLength(3);
  expect(out[0]).toBe(
    "::error title=Tests en échec (2)::web/src/a.test.tsx › A — fait 100 %25 ça: AssertionError: expected 1 to be 2%0Aweb/src/b.test.tsx › (le fichier): import failed",
  );
  expect(out[1]).toContain("::error file=web/src/a.test.tsx,line=12,title=A — fait 100 %25 ça::");
});

test("annotations — nothing for no failure, at most 9 files, under 60 KB", () => {
  expect(annotations([])).toEqual([]);
  const many = Array.from({ length: 40 }, (_, i) => ({
    file: `f${i}.ts`,
    name: "t",
    line: 1,
    message: "x".repeat(3000),
  }));
  const out = annotations(many);
  expect(out).toHaveLength(10);
  expect(Buffer.byteLength(out[0] ?? "")).toBeLessThan(61_000);
  expect(out[0]).toContain("et ");
  expect(escapeData("a\nb")).toBe("a%0Ab");
});

const at = (failureMessages: string[], failureDetails?: unknown[]) => ({
  testResults: [
    {
      name: "/repo/web/src/w.test.tsx",
      status: "failed",
      assertionResults: [{ status: "failed", fullName: "T", failureMessages, failureDetails }],
    },
  ],
});

test("failures — the assertion, not the stack frame, in WebKit and Firefox style messages", () => {
  // WebKit: the message, then frames ending in native code.
  expect(
    failures(
      at([
        "AssertionError: expected 1 to be 2\n@[native code]\nfoo@http://localhost:63315/a.js:1:2",
      ]),
      "/repo",
    )[0].message,
  ).toBe("AssertionError: expected 1 to be 2");
  // Firefox: frames first, the message after them.
  expect(
    failures(
      at([
        "getElementError@http://localhost:63315/@fs/x/context.js:3:4\n@http://localhost:63315/b.js:5:6\nCannot find element",
      ]),
      "/repo",
    )[0].message,
  ).toBe("Cannot find element");
  // Only frames: the name and the message of the error, when the report has them.
  expect(
    failures(
      at(
        ["@[native code]\nfoo@http://localhost:63315/a.js:1:2"],
        [{ name: "TypeError", message: "x is null\nmore" }],
      ),
      "/repo",
    )[0].message,
  ).toBe("TypeError: x is null");
  // Long lines are cut.
  expect(failures(at(["e".repeat(900)]), "/repo")[0].message.length).toBeLessThanOrEqual(300);
});

test("flaky — a test that passed after a failed attempt is a warning, with its attempt", () => {
  const flakyReport = {
    testResults: [
      {
        name: "/repo/web/src/f.test.tsx",
        status: "passed",
        assertionResults: [
          { status: "passed", fullName: "Stable", failureMessages: [] },
          {
            status: "passed",
            fullName: "Instable",
            failureMessages: ["Error: Timeout\n@[native code]", "AssertionError: x\n at y"],
          },
          { status: "failed", fullName: "Cassé", failureMessages: ["Error: z"] },
        ],
      },
    ],
  };
  const list = flaky(flakyReport, "/repo");
  expect(list).toEqual([
    {
      file: "web/src/f.test.tsx",
      name: "Instable",
      line: 1,
      attempts: 3,
      message: "Error: Timeout",
    },
  ]);
  const out = flakyAnnotations(list, "Tests instables — Chrome");
  expect(out[0]).toContain("::warning title=Tests instables — Chrome (1)::");
  expect(out[0]).toContain("Instable (réussi au 3e essai): Error: Timeout");
  expect(out[1]).toContain("title=Test instable (réussi au 3e essai)");
  expect(flakyAnnotations([])).toEqual([]);
});

test("silentFailure — a failed run with no failed test names its unhandled errors", () => {
  const log = [
    "ok line",
    "⎯⎯ Unhandled Errors ⎯⎯",
    "Error: boom in a timer",
    "    at x",
    "Test Files 1 passed",
  ].join("\n");
  const out = silentFailure({ success: false, testResults: [] }, log);
  expect(out).toHaveLength(1);
  expect(out[0]).toContain("::error title=La suite a échoué sans test en échec::");
  expect(out[0]).toContain("Error: boom in a timer");
  // No such section: the end of the log.
  expect(silentFailure({ success: false, testResults: [] }, "a\nb")[0]).toContain("a%0Ab");
  // A test failed, or the run succeeded: nothing to add.
  expect(silentFailure({ success: true, testResults: [] }, log)).toEqual([]);
  expect(
    silentFailure(
      { success: false, testResults: [{ name: "f", assertionResults: [{ status: "failed" }] }] },
      log,
    ),
  ).toEqual([]);
});

test("flakyTitle — « Tests en échec — Safari » devient « Tests instables — Safari », sans double espace", () => {
  expect(flakyTitle("Tests en échec — Safari (iPhone 15)")).toBe(
    "Tests instables — Safari (iPhone 15)",
  );
  expect(flakyTitle("Tests en échec —   Chrome")).toBe("Tests instables — Chrome");
});

const importFailure = { name: "/w/a.test.tsx", status: "failed", assertionResults: [] };
const passed = {
  name: "/w/b.test.tsx",
  status: "passed",
  assertionResults: [{ status: "passed" }],
};
const failedTest = {
  name: "/w/c.test.tsx",
  status: "failed",
  assertionResults: [{ status: "failed" }],
};
const rerun = { name: "/w/a.test.tsx", status: "passed", assertionResults: [{ status: "passed" }] };

test("filesToRerun — seuls les fichiers qui n'ont pas pu être importés sont relancés, même si un autre test a échoué", () => {
  // A file that did not import: a cold cache.
  expect(filesToRerun({ testResults: [passed, importFailure] }, "")).toEqual(["/w/a.test.tsx"]);
  // The same with a test that really failed in another file: the import failure is run again.
  expect(
    filesToRerun({ testResults: [importFailure, failedTest] }, "Failed to fetch dynamically"),
  ).toEqual(["/w/a.test.tsx"]);
  // Only a failed test: a failure, whatever the log says.
  expect(filesToRerun({ testResults: [failedTest] }, "Vite unexpectedly reloaded a test")).toBe(
    null,
  );
  // No failed file: only an error outside of a test, with the signature in the log: everything.
  expect(filesToRerun({ testResults: [passed] }, "Vite unexpectedly reloaded a test")).toEqual([]);
  expect(filesToRerun({ testResults: [passed] }, "some other unhandled error")).toBe(null);
});

// The unhandled-errors section of Vitest's default reporter, with its colours: a banner, then one
// banner per error (printErrorType), then a closing line of dashes. `after` is what follows it.
const DASHES = "⎯".repeat(20);
const section = (errors: string[], after = "\n Test Files  1 failed | 1 passed") =>
  `\u001b[31m${DASHES}\u001b[41m Unhandled Errors \u001b[49m${DASHES}\u001b[39m\n` +
  "Vitest caught errors during the test run.\n" +
  errors.map((error) => `\n${DASHES} Unhandled Rejection ${DASHES}\n${error}\n`).join("") +
  `\n${DASHES}\n${after}`;
const DYNAMIC =
  "TypeError: Failed to fetch dynamically imported module: http://localhost:63315/src/a.tsx";

test("filesToRerun — une erreur non gérée sans la signature d'un cache froid est un vrai échec, même avec un fichier non importé", () => {
  const files = { testResults: [importFailure, passed] };
  // A real error outside of a test: nothing is run again, or the second run would hide it.
  expect(filesToRerun(files, section(["TypeError: boom"]))).toBe(null);
  // An unhandled error that is the cold cache itself: the files are run again.
  expect(filesToRerun(files, section([DYNAMIC]))).toEqual(["/w/a.test.tsx"]);
  // Each error is judged on its own: one cold-cache error does not vouch for another.
  expect(filesToRerun(files, section([DYNAMIC, "TypeError: boom"]))).toBe(null);
  expect(filesToRerun(files, section(["TypeError: boom", DYNAMIC]))).toBe(null);
  // A section with no error under its banner is not understood: red, the safe way.
  expect(filesToRerun(files, section([]))).toBe(null);
  // The github-actions lines that follow quote the signature but are not part of the section,
  // even with no « Test Files » line between.
  const quoted = `::error title=Unhandled error::${DYNAMIC}`;
  expect(filesToRerun(files, section(["TypeError: boom"], quoted))).toBe(null);
  // A reload warning is printed during the run, never in the section: the whole suite is run
  // again only when there is no unhandled error at all, and a real one next to it is red.
  const reload = "Vite unexpectedly reloaded a test. This may cause tests to fail.\n";
  expect(filesToRerun({ testResults: [passed] }, reload)).toEqual([]);
  expect(filesToRerun({ testResults: [passed] }, reload + section(["TypeError: boom"]))).toBe(null);
});

test("filesToRerun — le trait d'un bloc « Serialized Error » ne ferme pas la section", () => {
  const files = { testResults: [importFailure, passed] };
  // printStack writes a line of dashes, then the own properties of the error, inside the error.
  const withProperties = `${DYNAMIC}\n${DASHES}\nSerialized Error: { code: 'ERR_X' }`;
  // A real error after it is still read: red.
  expect(filesToRerun(files, section([withProperties, "TypeError: boom"]))).toBe(null);
  // Only cold-cache errors: the files are run again.
  expect(filesToRerun(files, section([withProperties, DYNAMIC]))).toEqual(["/w/a.test.tsx"]);
});

test("filesToRerun — la signature d'un cache froid dans Firefox et dans WebKit", () => {
  for (const message of [
    "TypeError: error loading dynamically imported module: http://localhost:63315/src/a.tsx",
    "TypeError: Importing a module script failed.",
  ]) {
    expect(filesToRerun({ testResults: [passed] }, message)).toEqual([]);
  }
});

test("mergeReports — le second passage prend la place des fichiers relancés, les vrais échecs du premier restent", () => {
  const clean = mergeReports({ testResults: [importFailure] }, { testResults: [rerun] });
  expect(clean.success).toBe(true);
  expect(clean.testResults).toEqual([rerun]);
  const kept = mergeReports({ testResults: [importFailure, failedTest] }, { testResults: [rerun] });
  expect(kept.success).toBe(false);
  expect(kept.testResults.map((file: { name: string }) => file.name)).toEqual([
    "/w/c.test.tsx",
    "/w/a.test.tsx",
  ]);
});
