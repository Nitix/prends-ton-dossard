import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { pixelURL } from "../test/images";
import { Avatar, tintOf } from "./Avatar";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  getURL: vi.fn<(record: Rec, filename: string, options: Rec) => string>(),
}));

vi.mock("../lib/pb", () => ({ pb: { files: { getURL: mocks.getURL } } }));

const base = {
  created: "",
  updated: "",
  collectionId: "runners0000000",
  collectionName: "runners",
};
const alice = { ...base, id: "aliceRunner0000", name: "Alice Martin", user: "u-alice", avatar: "" };
const withPhoto = { ...alice, avatar: "alice_k3j9x2.webp" };

beforeEach(() => {
  mocks.getURL.mockReset();
  mocks.getURL.mockImplementation(() => pixelURL());
});

test("Avatar — sans photo, les initiales, et pb.files n'est pas appelé", async () => {
  const screen = await render(<Avatar runner={alice} thumb="96x96" />);

  const initials = screen.getByText("AM", { exact: true });
  await expect.element(initials).toBeVisible();
  // Read out nowhere: the name is always written next to an avatar.
  await expect.element(initials).toHaveAttribute("aria-hidden", "true");
  expect(screen.container.querySelector("img")).toBeNull();
  expect(mocks.getURL).not.toHaveBeenCalled();
});

test('Avatar — avec une photo, une <img alt=""> sur la vignette 96x96', async () => {
  const screen = await render(<Avatar runner={withPhoto} thumb="96x96" />);

  const image = screen.container.querySelector("img");
  expect(image).not.toBeNull();
  expect(image?.getAttribute("alt")).toBe("");
  expect(image?.getAttribute("src")).toBe(pixelURL());
  expect(image?.getAttribute("decoding")).toBe("async");
  expect(image?.getAttribute("loading")).toBe("lazy");
  expect(image?.className).toContain("rounded-full");
  expect(image?.className).toContain("object-cover");
  expect(mocks.getURL).toHaveBeenCalledWith(withPhoto, "alice_k3j9x2.webp", { thumb: "96x96" });
  await expect.element(screen.getByText("AM", { exact: true })).not.toBeInTheDocument();
});

test("Avatar — la vignette demandée est celle de la taille", async () => {
  await render(<Avatar runner={withPhoto} thumb="256x256" />);

  expect(mocks.getURL).toHaveBeenCalledWith(withPhoto, "alice_k3j9x2.webp", { thumb: "256x256" });
});

test("Avatar — si l'image ne se charge pas, retour aux initiales", async () => {
  const screen = await render(<Avatar runner={withPhoto} thumb="96x96" />);
  const image = screen.container.querySelector("img");
  expect(image).not.toBeNull();

  image?.dispatchEvent(new Event("error"));

  await expect.element(screen.getByText("AM", { exact: true })).toBeVisible();
  expect(screen.container.querySelector("img")).toBeNull();
});

test("Avatar — une nouvelle photo après un échec est essayée", async () => {
  // Each file has its own address, as on the server.
  mocks.getURL.mockImplementation((_record, filename) => `${pixelURL()}#${filename}`);
  const screen = await render(<Avatar runner={withPhoto} thumb="96x96" />);
  screen.container.querySelector("img")?.dispatchEvent(new Event("error"));
  await expect.element(screen.getByText("AM", { exact: true })).toBeVisible();

  await screen.rerender(
    <Avatar runner={{ ...withPhoto, avatar: "alice_n3w0000.webp" }} thumb="96x96" />,
  );

  expect(screen.container.querySelector("img")).not.toBeNull();
  await expect.element(screen.getByText("AM", { exact: true })).not.toBeInTheDocument();
});

test("Avatar — la classe donnée va sur la photo comme sur les initiales", async () => {
  const photo = await render(<Avatar runner={withPhoto} thumb="96x96" className="size-12" />);
  expect(photo.container.querySelector("img")?.classList.contains("size-12")).toBe(true);
  await photo.unmount();

  const initials = await render(<Avatar runner={alice} thumb="96x96" className="size-12" />);
  expect(initials.getByText("AM").element().classList.contains("size-12")).toBe(true);
});

test("Avatar — la photo et les initiales portent .avatar, les initiales une teinte de 0 à 11, toujours la même pour un coureur", async () => {
  const bare = await render(<Avatar runner={alice} thumb="96x96" />);
  const initials = bare.getByText("AM", { exact: true }).element();
  expect(initials.classList.contains("avatar")).toBe(true);
  expect(initials.getAttribute("data-tint")).toBe(String(tintOf(alice.id)));
  await bare.unmount();
  const photo = await render(<Avatar runner={withPhoto} thumb="96x96" />);
  const img = photo.container.querySelector("img");
  expect(img?.classList.contains("avatar")).toBe(true);
  expect(img?.hasAttribute("data-tint")).toBe(false);
  await photo.unmount();
  // The same runner, the same tint; the tints spread over the twelve.
  expect(tintOf("aliceRunner0000")).toBe(tintOf("aliceRunner0000"));
  const tints = new Set(Array.from({ length: 60 }, (_, i) => tintOf(`runner${i}`)));
  expect([...tints].every((tint) => Number.isInteger(tint) && tint >= 0 && tint < 12)).toBe(true);
  expect(tints.size).toBeGreaterThan(8);
});
