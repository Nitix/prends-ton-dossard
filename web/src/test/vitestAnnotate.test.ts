import { expect, test } from "vitest";

// @ts-expect-error a script in plain JavaScript
import { annotations, escapeData, failures } from "../../../tools/ci/vitest-annotate.mjs";

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
