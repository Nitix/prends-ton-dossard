import { beforeEach } from "vitest";

// Setup file of the browser project (see vite.config.ts).
//
// Chromium on Windows hands `navigator.credentials.create()` and `get()` to
// the Windows WebAuthn API, which opens a native passkey / security key dialog
// even when the browser is headless. A test that reaches the real API would
// disturb whoever runs the suite, so both methods are replaced with ones that
// fail loudly: the test must stub `navigator.credentials` itself, as the
// tests of the passkeys do.
//
// The guard is an own property of `navigator.credentials`, so that
// `vi.spyOn(navigator.credentials, "get")` wraps it, and `vi.restoreAllMocks()`
// gives it back. It is installed again before each test: this `beforeEach` is
// registered before the ones of the test file, so those run after it and see
// the guard, never the real API.

type Method = "create" | "get";

function blocked(method: Method) {
  return (): Promise<never> =>
    Promise.reject(
      new Error(
        `Real WebAuthn call in a test: navigator.credentials.${method}() — stub navigator.credentials in this test`,
      ),
    );
}

function installGuard() {
  if (typeof navigator.credentials === "undefined") return;
  for (const method of ["create", "get"] as const) {
    Object.defineProperty(navigator.credentials, method, {
      value: blocked(method),
      configurable: true,
      writable: true,
    });
  }
}

// Once now, for what a test file does as it is imported, and before each test.
installGuard();
beforeEach(installGuard);
