import { afterEach } from "vitest";

declare module "vitest" {
  interface TaskMeta {
    /** The name and message of the error of a failed test (see below). */
    failure?: string;
  }
}

// Setup file of the browser project (see vite.config.ts).
//
// Firefox and WebKit write the stack of an error without its message, and the JSON report of
// Vitest only has the stack (`failureMessages`): the annotations of CI
// (tools/ci/vitest-annotate.mjs) would say « @[native code] ». The message of a failure is put
// in the `meta` of the test, which the report keeps.
afterEach((context) => {
  const error = context.task.result?.errors?.[0];
  if (error) context.task.meta.failure = `${error.name ?? "Error"}: ${error.message}`;
});
