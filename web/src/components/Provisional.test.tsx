import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import "../styles.css";
import { Provisional } from "./Provisional";

test("shows the app name in a heading", async () => {
  const screen = await render(<Provisional />);

  const heading = screen.getByRole("heading", { name: "Courses" });
  await expect.element(heading).toBeVisible();
  // Tailwind is compiled for the browser tests (font-semibold).
  expect(getComputedStyle(heading.element()).fontWeight).toBe("600");
});
