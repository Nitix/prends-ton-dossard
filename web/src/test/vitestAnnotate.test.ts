import { expect, test } from "vitest";

// @ts-expect-error a script in plain JavaScript
import * as tool from "../../../tools/ci/vitest-annotate.mjs";

const { annotations, escapeData, failures, flaky, flakyAnnotations } = tool;

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
