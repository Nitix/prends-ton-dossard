import { expect, test } from "vitest";

// @ts-expect-error a script in plain JavaScript
import { filesToRerun, mergeReports } from "../../../tools/ci/cold-cache.mjs";
// @ts-expect-error a script in plain JavaScript
import * as tool from "../../../tools/ci/vitest-annotate.mjs";

const {
  annotations,
  clickProbeAnnotations,
  clickProbes,
  clickTimes,
  escapeData,
  failures,
  flaky,
  flakyAnnotations,
  flakyTitle,
  probeTitle,
  silentFailure,
} = tool;

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

// The call log of a Playwright timeout, as WebKit writes it: the steps, then the stack.
const callLog = (steps: string[]) =>
  [
    "TimeoutError: locator.click: Timeout 5000ms exceeded.",
    "Call log:",
    ...steps.map((step) => `  - ${step}`),
    "@[native code]",
  ].join("\n");
// What the annotation keeps of the call log: the text between the brackets, step by step.
const keptSteps = (message: string) =>
  message.slice(message.indexOf("[") + 1, message.lastIndexOf("]")).split(" / ");

test("failures — le journal d'un délai de Playwright garde ses 10 dernières étapes, la dernière visible", () => {
  const steps = Array.from({ length: 12 }, (_, i) => `step ${i + 1}`);
  const kept = keptSteps(failures(at([callLog(steps)]), "/repo")[0].message);
  expect(kept).toEqual(steps.slice(-10).map((step) => `- ${step}`));
});

test("failures — une étape longue (le HTML d'un bouton) est coupée à 160 caractères, la suite reste", () => {
  const html = `locator resolved to <button class="${"x".repeat(400)}">Confirmer</button>`;
  const kept = keptSteps(
    failures(at([callLog(["attempting click action", html, "done scrolling"])]), "/repo")[0]
      .message,
  );
  expect(kept).toHaveLength(3);
  expect(kept[1]).toHaveLength(160);
  expect(kept[1]?.endsWith("…")).toBe(true);
  expect(kept[2]).toBe("- done scrolling");
});

// A record of src/test/clickProbe.ts, as the meta of a test keeps it.
const probe = {
  attempt: 0,
  ms: 5012,
  error: "TimeoutError: locator.click: Timeout 5000ms exceeded.",
  doc: { visibility: "visible", hidden: false, focus: false },
  top: { visibility: "visible", focus: true },
  raf: { total: 31, maxGap: 4100, first: 12, per500: [30, 1, 0] },
  timer: { total: 1200, maxGap: 20, per500: [120, 120, 118] },
  events: { scroll: 3, pointerdown: 4800 },
  frame: "0,0 414×896 dans 414×896",
  targetStart: "20,900 300×44 dans 414×896, défilé 0,0",
  target: "20,700 300×44 dans 414×896, défilé 0,120",
  node: {
    maxLag: 3800,
    per500: [0, 0, 3800],
    over100: 3,
    samples: 40,
    rpcMs: 12,
    load: [5.2, 4.1, 3],
    contexts: 3,
  },
};
const probeReport = {
  testResults: [
    {
      name: "/repo/web/src/h.test.tsx",
      status: "passed",
      assertionResults: [
        {
          status: "passed",
          fullName: "Lent",
          failureMessages: ["x"],
          meta: { clickMs: [100, 5012, 300], clickProbe: [probe] },
        },
        {
          status: "passed",
          fullName: "Rapide",
          failureMessages: [],
          meta: { clickMs: [200, 250] },
        },
        { status: "passed", fullName: "Sans clic", failureMessages: [] },
      ],
    },
  ],
};

test("clickProbes — les clics lents de la sonde, avec leur fichier et leur test, et la durée de tous les clics", () => {
  expect(clickProbes(probeReport, "/repo")).toEqual([
    { file: "web/src/h.test.tsx", name: "Lent", ...probe },
  ]);
  expect(clickTimes(probeReport)).toEqual([100, 5012, 300, 200, 250]);
});

test("clickProbeAnnotations — un avis : la répartition des clics, puis chaque clic lent avec ses mesures", () => {
  const out = clickProbeAnnotations(
    clickProbes(probeReport, "/repo"),
    clickTimes(probeReport),
    probeTitle("Tests en échec — Safari #3"),
  );
  expect(out).toHaveLength(1);
  const text = decodeURIComponent(out[0] ?? "");
  expect(out[0]).toMatch(/^::notice title=Clics lents — Safari #3 \(1\)::/);
  expect(text).toContain("Clics lents ou en échec : 1 sur 5 clics mesurés.");
  expect(text).toContain("médiane 250 ms, p90 5012 ms, p99 5012 ms, max 5012 ms");
  expect(text).toContain("1,5–2 s : 0 · 2–3 s : 0 · 3–5 s : 0 · ≥ 5 s : 1 · en échec : 1");
  expect(text).toContain(
    "web/src/h.test.tsx › Lent [essai 1] 5012 ms TimeoutError: locator.click: Timeout 5000ms exceeded.",
  );
  expect(text).toContain("page visible hidden=false focus=false, autour visible focus=true");
  expect(text).toContain("rAF 31, écart max 4100 ms, 1er à 12 ms, par 500 ms : 30 1 0");
  expect(text).toContain("setTimeout(0) 1200, écart max 20 ms, par 500 ms : 120 120 118");
  expect(text).toContain("évènements (ms) : scroll 3 pointerdown 4800");
  expect(text).toContain("iframe 0,0 414×896 dans 414×896");
  expect(text).toContain(
    "cible au début 20,900 300×44 dans 414×896, défilé 0,0 ; à la fin 20,700 300×44 dans 414×896, défilé 0,120",
  );
  expect(text).toContain(
    "Node : retard max 3800 ms, par 500 ms : 0 0 3800, > 100 ms ×3, 40 relevés, appel 12 ms, charge 5.2 4.1 3, 3 contextes",
  );
});

test("clickProbeAnnotations — sans clic lent, l'avis dit quand même combien de clics ont été mesurés ; sans sonde, rien", () => {
  const fast = clickProbeAnnotations([], [200, 250], "Clics lents — Safari #1");
  expect(fast).toHaveLength(1);
  expect(decodeURIComponent(fast[0] ?? "")).toContain(
    "Clics lents ou en échec : 0 sur 2 clics mesurés.",
  );
  expect(clickProbeAnnotations([], [], "Clics lents")).toEqual([]);
});

test("clickProbeAnnotations — les plus lents d'abord, sous 60 Ko", () => {
  const many = Array.from({ length: 400 }, (_, i) => ({
    file: "f.test.tsx",
    name: `t${i}`,
    ...probe,
    ms: 1600 + i,
    error: undefined,
  }));
  const out = clickProbeAnnotations(many, [1], "Clics lents");
  expect(Buffer.byteLength(out[0] ?? "")).toBeLessThan(61_000);
  const text = decodeURIComponent(out[0] ?? "");
  expect(text.indexOf("› t399 ")).toBeLessThan(text.indexOf("› t398 "));
  expect(text).toContain("… et ");
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
// errorBanner: a title between red dashes, in bold on a red background.
const banner = (title: string) =>
  `\u001b[31m${DASHES}\u001b[39m\u001b[1m\u001b[41m ${title} \u001b[49m\u001b[22m\u001b[31m${DASHES}\u001b[39m`;
// One error, under the banner of its type. A bare string is an « Unhandled Rejection », the type
// of a failed import. The browser reports an exception thrown in an event handler, a timer or a
// React callback as « Error », and the tester and the server use « Run Error », « Browser Error »…
type Unhandled = string | [type: string, error: string];
const typed = (error: Unhandled): [string, string] =>
  typeof error === "string" ? ["Unhandled Rejection", error] : error;
const section = (errors: Unhandled[], after = "\n Test Files  1 failed | 1 passed") =>
  `${banner("Unhandled Errors")}\n` +
  "Vitest caught errors during the test run.\n" +
  errors
    .map(typed)
    .map(([type, error]) => `\n${banner(type)}\n${error}\n`)
    .join("") +
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

// Whatever its type, a real error is judged on its own: next to a cold-cache error, before it or
// after it, it is red.
test.each<[string, Unhandled[]]>([
  ["« Error » après une erreur de cache froid", [DYNAMIC, ["Error", "Error: boom"]]],
  ["« Error » avant une erreur de cache froid", [["Error", "Error: boom"], DYNAMIC]],
  ["« Run Error » après une erreur de cache froid", [DYNAMIC, ["Run Error", "Error: boom"]]],
])("filesToRerun — une vraie erreur sous la bannière %s est un vrai échec", (_, errors) => {
  expect(filesToRerun({ testResults: [importFailure, passed] }, section(errors))).toBe(null);
});

// On a narrow terminal a title of 29 columns or more leaves no room for dashes on one side.
test("filesToRerun — une vraie erreur sous une bannière sans trait d'un côté est un vrai échec", () => {
  const long = "A Very Long Title Of An Error Type";
  const bare = `[31m${DASHES}[39m[1m[41m ${long} [49m[22m`;
  const errors = `
${banner("Unhandled Rejection")}
${DYNAMIC}

${bare}
Error: boom
`;
  const log = `${banner("Unhandled Errors")}
Vitest caught errors during the test run.
${errors}
${DASHES}
 Test Files  1 failed`;
  expect(filesToRerun({ testResults: [importFailure, passed] }, log)).toBe(null);
});

test("filesToRerun — des erreurs de cache froid sous des bannières différentes font relancer les fichiers", () => {
  const errors: Unhandled[] = [DYNAMIC, ["Error", DYNAMIC]];
  expect(filesToRerun({ testResults: [importFailure, passed] }, section(errors))).toEqual([
    "/w/a.test.tsx",
  ]);
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
