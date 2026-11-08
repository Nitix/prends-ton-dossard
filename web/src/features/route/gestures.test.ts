import { expect, test, vi } from "vitest";

import { coarsePointer, zoomModifier } from "./gestures";

test("zoomModifier — ⌘ on Apple devices, Ctrl elsewhere", () => {
  const ua = "Mozilla/5.0";
  expect(zoomModifier({ platform: "MacIntel", userAgent: ua })).toBe("⌘");
  expect(zoomModifier({ platform: "iPhone", userAgent: ua })).toBe("⌘");
  expect(zoomModifier({ platform: "iPad", userAgent: ua })).toBe("⌘");
  expect(
    zoomModifier({ platform: "", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" }),
  ).toBe("⌘");
  expect(zoomModifier({ platform: "Win32", userAgent: ua })).toBe("Ctrl");
  expect(zoomModifier({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux)" })).toBe(
    "Ctrl",
  );
  expect(zoomModifier({ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Android 14)" })).toBe(
    "Ctrl",
  );
});

test("coarsePointer — reads (pointer: coarse)", () => {
  const matchMedia = vi.fn<(query: string) => { matches: boolean }>((query) => ({
    matches: query === "(pointer: coarse)",
  }));
  expect(coarsePointer({ matchMedia })).toBe(true);
  expect(matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
  expect(coarsePointer({ matchMedia: () => ({ matches: false }) })).toBe(false);
});
