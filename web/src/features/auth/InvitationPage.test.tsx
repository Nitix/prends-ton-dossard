import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { TodayProvider } from "../../lib/useToday";
import { InvitationPage } from "./InvitationPage";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

const LOOKUP = "/api/app/invitations/lookup";
const ACCEPT = "/api/app/invitations/accept";

const send = vi.hoisted(() =>
  vi.fn<(path: string, options: { method: string; body: unknown }) => Promise<unknown>>(),
);
const save = vi.hoisted(() => vi.fn<(token: string, record: unknown) => void>());

vi.mock("../../lib/pb", () => ({ pb: { send, authStore: { save } } }));

const INVITE = { runnerName: "Sam", kind: "invite" };
const RESET = { runnerName: "Sam", kind: "reset" };
const SESSION = { token: "session-token", record: { id: "u1", collectionName: "users" } };

/** The address of the page, as the browser has it when somebody opens the link. */
function openLink(token: string) {
  window.history.replaceState(null, "", `${location.pathname}${location.search}#${token}`);
}

beforeEach(() => {
  send.mockReset();
  save.mockReset();
  openLink("the-token");
});

afterEach(() => {
  window.history.replaceState(null, "", `${location.pathname}${location.search}`);
});

/**
 * What the server answers, by route. An Error is a refusal, a promise is
 * returned as it is (one that never settles is a request still in flight).
 */
function serve(answers: { lookup: unknown; accept?: unknown }) {
  send.mockImplementation((path) => {
    const answer = path === LOOKUP ? answers.lookup : answers.accept;
    if (answer instanceof Error) return Promise.reject(answer);
    return answer instanceof Promise ? answer : Promise.resolve(answer);
  });
}

function refusal(status: number, code: string) {
  return new ClientResponseError({ status, response: { status, message: code, data: { code } } });
}

/** A validation error of PocketBase on a record field, not one of our codes. */
function fieldRefusal(field: string, code: string) {
  return new ClientResponseError({
    status: 400,
    response: { status: 400, message: "Failed to create record.", data: { [field]: { code } } },
  });
}

/**
 * The invitation page at /invitation, with a home page to land on. `strict`
 * renders it like the app does, in React's StrictMode, which renders twice and
 * runs the effects twice.
 */
function renderInvitation({
  strict = false,
  languages = ["fr"],
}: { strict?: boolean; languages?: readonly string[] } = {}) {
  const root = createRootRoute();
  const invitation = createRoute({
    getParentRoute: () => root,
    path: "/invitation",
    component: InvitationPage,
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Page d'accueil</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([invitation, home]),
    history: createMemoryHistory({ initialEntries: ["/invitation"] }),
  });
  const page = (
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider languages={languages}>
        <TodayProvider value={Temporal.PlainDate.from("2026-11-09")}>
          <RouterProvider router={router} />
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

type Screen = Awaited<ReturnType<typeof renderInvitation>>;

const email = (screen: Screen) => screen.getByLabelText(fr.auth.email, { exact: true });
const password = (screen: Screen) => screen.getByLabelText(fr.auth.password, { exact: true });
const confirmation = (screen: Screen) =>
  screen.getByLabelText(fr.auth.passwordConfirm, { exact: true });

/** The text of the element that an input points to with aria-describedby. */
function describedBy(input: { element(): Element }): string[] {
  const ids = input.element().getAttribute("aria-describedby")?.split(" ") ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? "");
}

async function fillInvite(screen: Screen, secret = "long-enough-secret", again = secret) {
  await email(screen).fill("sam@example.test");
  await password(screen).fill(secret);
  await confirmation(screen).fill(again);
}

async function fillReset(screen: Screen, secret = "long-enough-secret", again = secret) {
  await password(screen).fill(secret);
  await confirmation(screen).fill(again);
}

test("InvitationPage — affiche t.errors.invitation_invalid quand le jeton est refusé", async () => {
  serve({ lookup: refusal(404, "invitation_invalid") });
  const screen = await renderInvitation();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.invitation_invalid);
  await expect.element(password(screen)).not.toBeInTheDocument();
  expect(send).toHaveBeenCalledWith(LOOKUP, {
    method: "POST",
    body: { token: "the-token", lang: "fr" },
  });
});

test("InvitationPage — un fragment vide est un lien invalide, sans appeler l'API", async () => {
  openLink("");
  const screen = await renderInvitation();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.invitation_invalid);
  await expect.element(password(screen)).not.toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();
});

test("InvitationPage — retire le jeton de la barre d'adresse, sans ajouter d'entrée à l'historique", async () => {
  window.history.replaceState({ kept: true }, "", `${location.pathname}${location.search}#tok`);
  const entries = window.history.length;
  serve({ lookup: INVITE });

  const screen = await renderInvitation();

  await expect.element(screen.getByRole("heading")).toHaveTextContent(fr.auth.welcome("Sam"));
  expect(location.hash).toBe("");
  expect(location.href).not.toContain("tok");
  expect(window.history.length).toBe(entries);
  // What else is in the history state (the router's own) is left alone.
  expect(window.history.state).toEqual({ kept: true });
  // The token is still known to the page: it is the one that was looked up.
  expect(send).toHaveBeenCalledWith(LOOKUP, { method: "POST", body: { token: "tok", lang: "fr" } });
});

test("InvitationPage — un nouveau lien ouvert dans le même onglet remplace le précédent", async () => {
  send.mockRejectedValueOnce(refusal(404, "invitation_invalid"));
  send.mockResolvedValueOnce(RESET);
  const screen = await renderInvitation();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.invitation_invalid);

  // Only the fragment changes: the page is not loaded again.
  location.hash = "#the-new-token";

  await expect.element(screen.getByRole("heading")).toHaveTextContent(fr.auth.resetTitle("Sam"));
  expect(send).toHaveBeenLastCalledWith(LOOKUP, {
    method: "POST",
    body: { token: "the-new-token", lang: "fr" },
  });
  expect(location.hash).toBe("");
});

test("InvitationPage — en StrictMode, le jeton survit au double rendu et au double effet", async () => {
  serve({ lookup: INVITE });
  const screen = await renderInvitation({ strict: true });

  await expect.element(screen.getByRole("heading")).toHaveTextContent(fr.auth.welcome("Sam"));
  expect(location.hash).toBe("");
  expect(send).toHaveBeenCalled();
  for (const call of send.mock.calls) {
    expect(call).toEqual([LOOKUP, { method: "POST", body: { token: "the-token", lang: "fr" } }]);
  }
});

test("InvitationPage — invitation : « Bienvenue Sam », avec les champs email et mot de passe", async () => {
  serve({ lookup: INVITE });
  const screen = await renderInvitation();

  await expect.element(screen.getByRole("heading")).toHaveTextContent(fr.auth.welcome("Sam"));
  await expect.element(email(screen)).toBeVisible();
  await expect.element(password(screen)).toBeVisible();
  await expect.element(confirmation(screen)).toBeVisible();
  await expect.element(screen.getByRole("button", { name: fr.auth.createAccount })).toBeVisible();
});

test("InvitationPage — les champs ont les bons autocomplete, et le bouton fait au moins 44 px", async () => {
  serve({ lookup: INVITE });
  const screen = await renderInvitation();

  await expect.element(email(screen)).toHaveAttribute("autocomplete", "email");
  await expect.element(password(screen)).toHaveAttribute("autocomplete", "new-password");
  await expect.element(confirmation(screen)).toHaveAttribute("autocomplete", "new-password");
  await expect.element(password(screen)).toHaveAttribute("type", "password");
  await expect.element(confirmation(screen)).toHaveAttribute("type", "password");
  const button = screen.getByRole("button", { name: fr.auth.createAccount }).element();
  expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(email(screen).element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});

test("InvitationPage — réinitialisation : pas de champ email", async () => {
  serve({ lookup: RESET });
  const screen = await renderInvitation();

  await expect.element(screen.getByRole("heading")).toHaveTextContent(fr.auth.resetTitle("Sam"));
  await expect.element(password(screen)).toBeVisible();
  await expect.element(confirmation(screen)).toBeVisible();
  await expect.element(email(screen)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: fr.auth.changePassword })).toBeVisible();
});

test("InvitationPage — email_taken : le message est sous le champ email, et les valeurs saisies sont conservées", async () => {
  serve({ lookup: INVITE, accept: refusal(400, "email_taken") });
  const screen = await renderInvitation();

  await expect.element(email(screen)).toBeVisible();
  await fillInvite(screen);
  await screen.getByRole("button", { name: fr.auth.createAccount }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.email_taken);
  expect(describedBy(email(screen))).toEqual([fr.errors.email_taken]);
  await expect.element(email(screen)).toHaveAttribute("aria-invalid", "true");
  // The other fields have nothing to say about it.
  await expect.element(password(screen)).toHaveAttribute("aria-invalid", "false");
  expect(describedBy(password(screen))).toEqual([fr.auth.passwordHint]);
  await expect.element(email(screen)).toHaveValue("sam@example.test");
  await expect.element(password(screen)).toHaveValue("long-enough-secret");
  await expect.element(confirmation(screen)).toHaveValue("long-enough-secret");
  expect(save).not.toHaveBeenCalled();
});

test("InvitationPage — email_invalid : le message est sous le champ email", async () => {
  serve({ lookup: INVITE, accept: refusal(400, "email_invalid") });
  const screen = await renderInvitation();

  await expect.element(email(screen)).toBeVisible();
  await fillInvite(screen);
  await screen.getByRole("button", { name: fr.auth.createAccount }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.email_invalid);
  expect(describedBy(email(screen))).toEqual([fr.errors.email_invalid]);
});

test("InvitationPage — password_too_short : le message est sous le mot de passe, avec l'indication", async () => {
  serve({ lookup: RESET, accept: refusal(400, "password_too_short") });
  const screen = await renderInvitation();

  await expect.element(password(screen)).toBeVisible();
  await fillReset(screen, "short");
  await screen.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.password_too_short);
  expect(describedBy(password(screen))).toEqual([
    fr.auth.passwordHint,
    fr.errors.password_too_short,
  ]);
  await expect.element(password(screen)).toHaveAttribute("aria-invalid", "true");
  await expect.element(confirmation(screen)).toHaveAttribute("aria-invalid", "false");
  await expect.element(password(screen)).toHaveValue("short");
});

test("InvitationPage — password_mismatch : le message est sous la confirmation", async () => {
  serve({ lookup: RESET, accept: refusal(400, "password_mismatch") });
  const screen = await renderInvitation();

  await expect.element(password(screen)).toBeVisible();
  await fillReset(screen, "long-enough-secret", "another-long-secret");
  await screen.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.password_mismatch);
  expect(describedBy(confirmation(screen))).toEqual([fr.errors.password_mismatch]);
  await expect.element(confirmation(screen)).toHaveAttribute("aria-invalid", "true");
  await expect.element(password(screen)).toHaveAttribute("aria-invalid", "false");
  await expect.element(password(screen)).toHaveValue("long-enough-secret");
  await expect.element(confirmation(screen)).toHaveValue("another-long-secret");
});

test("InvitationPage — l'erreur de validation d'un champ par PocketBase va sous ce champ", async () => {
  serve({ lookup: INVITE, accept: fieldRefusal("email", "validation_not_unique") });
  const screen = await renderInvitation();

  await expect.element(email(screen)).toBeVisible();
  await fillInvite(screen);
  await screen.getByRole("button", { name: fr.auth.createAccount }).click();

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_not_unique);
  expect(describedBy(email(screen))).toEqual([fr.errors.validation_not_unique]);
});

test("InvitationPage — 403 account_disabled à la réinitialisation : message pour tout le formulaire", async () => {
  serve({ lookup: RESET, accept: refusal(403, "account_disabled") });
  const screen = await renderInvitation();

  await expect.element(password(screen)).toBeVisible();
  await fillReset(screen);
  await screen.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.account_disabled);
  // Not tied to a field: no field points to it.
  expect(describedBy(password(screen))).toEqual([fr.auth.passwordHint]);
  expect(describedBy(confirmation(screen))).toEqual([]);
  expect(save).not.toHaveBeenCalled();
});

test("InvitationPage — une panne réseau à l'envoi affiche le message générique, valeurs conservées", async () => {
  serve({ lookup: INVITE, accept: new TypeError("Failed to fetch") });
  const screen = await renderInvitation();

  await expect.element(email(screen)).toBeVisible();
  await fillInvite(screen);
  await screen.getByRole("button", { name: fr.auth.createAccount }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect.element(email(screen)).toHaveValue("sam@example.test");
  await expect.element(password(screen)).toHaveValue("long-enough-secret");
});

test("InvitationPage — succès d'une invitation : envoie le jeton, l'email et le mot de passe, enregistre la session et va à /", async () => {
  serve({ lookup: INVITE, accept: SESSION });
  const screen = await renderInvitation();

  await expect.element(email(screen)).toBeVisible();
  await fillInvite(screen);
  await screen.getByRole("button", { name: fr.auth.createAccount }).click();

  await expect.element(screen.getByText("Page d'accueil")).toBeVisible();
  expect(send).toHaveBeenLastCalledWith(ACCEPT, {
    method: "POST",
    body: {
      token: "the-token",
      email: "sam@example.test",
      password: "long-enough-secret",
      passwordConfirm: "long-enough-secret",
    },
  });
  expect(save).toHaveBeenCalledExactlyOnceWith("session-token", SESSION.record);
});

test("InvitationPage — succès d'une réinitialisation : pas d'email dans la requête", async () => {
  serve({ lookup: RESET, accept: SESSION });
  const screen = await renderInvitation();

  await expect.element(password(screen)).toBeVisible();
  await fillReset(screen);
  await screen.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect.element(screen.getByText("Page d'accueil")).toBeVisible();
  expect(send).toHaveBeenLastCalledWith(ACCEPT, {
    method: "POST",
    body: {
      token: "the-token",
      password: "long-enough-secret",
      passwordConfirm: "long-enough-secret",
    },
  });
  expect(save).toHaveBeenCalledExactlyOnceWith("session-token", SESSION.record);
});

test("InvitationPage — pendant l'envoi, le bouton est désactivé (pas de double envoi)", async () => {
  serve({ lookup: INVITE, accept: new Promise(() => {}) });
  const screen = await renderInvitation();

  await expect.element(email(screen)).toBeVisible();
  await fillInvite(screen);
  await screen.getByRole("button", { name: fr.auth.createAccount }).click();

  const button = screen.getByRole("button", { name: fr.auth.saving });
  await expect.element(button).toBeDisabled();
  expect(send.mock.calls.filter(([path]) => path === ACCEPT)).toHaveLength(1);
});

test("InvitationPage — une panne réseau à la vérification propose de réessayer, avec le même jeton", async () => {
  send.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  send.mockResolvedValueOnce(INVITE);
  const screen = await renderInvitation();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect.element(email(screen)).not.toBeInTheDocument();
  const retry = screen.getByRole("button", { name: fr.common.retry });
  expect(retry.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await retry.click();

  await expect.element(screen.getByRole("heading")).toHaveTextContent(fr.auth.welcome("Sam"));
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenNthCalledWith(2, LOOKUP, {
    method: "POST",
    body: { token: "the-token", lang: "fr" },
  });
});

type Line = {
  event: string;
  location: string;
  day: string;
  monthOnly: boolean;
  formats?: string[];
  people: string[];
  morePeople: number;
};

function line(event: string, extra: Partial<Line> = {}): Line {
  return {
    event,
    location: "Annecy",
    day: "2026-11-14",
    monthOnly: false,
    formats: ["Trail long"],
    people: [],
    morePeople: 0,
    ...extra,
  };
}

function previewOf(extra: Record<string, unknown> = {}) {
  return {
    runnerName: "Sam",
    kind: "invite",
    invitedBy: "Alex",
    upcoming: { total: 0, races: [] },
    group: [],
    ...extra,
  };
}

test("InvitationPage — aperçu : le titre et la phrase avec un auteur", async () => {
  serve({ lookup: previewOf() });
  const screen = await renderInvitation();

  await expect
    .element(screen.getByRole("heading", { level: 1 }))
    .toHaveTextContent(fr.auth.invitedYou("Alex"));
  await expect.element(screen.getByText(fr.auth.intro, { exact: true })).toBeVisible();
});

test("InvitationPage — aperçu : la même phrase sans auteur (invitedBy null)", async () => {
  serve({ lookup: previewOf({ invitedBy: null }) });
  const screen = await renderInvitation();

  await expect
    .element(screen.getByRole("heading", { level: 1 }))
    .toHaveTextContent(fr.auth.welcome("Sam"));
  await expect.element(screen.getByText(fr.auth.intro, { exact: true })).toBeVisible();
});

test("InvitationPage — aperçu : la ligne compacte dit la date et la course, sans lieu, épreuve ni compte à rebours", async () => {
  serve({ lookup: previewOf({ upcoming: { total: 1, races: [line("Course A")] } }) });
  const screen = await renderInvitation();

  const item = screen.getByRole("listitem");
  const said = item.element().textContent;
  expect(said).toContain("sam. 14 nov.");
  expect(said).toContain("Course A");
  expect(said).not.toContain("Annecy");
  expect(said).not.toContain("Trail long");
  expect(said).not.toMatch(/dans [0-9]+ jours?/);
  // No card around it.
  expect(screen.getByRole("heading", { level: 3 }).elements()).toHaveLength(0);
  expect(item.element().classList.contains("card")).toBe(false);
});

test("InvitationPage — aperçu : « avec … +N » sous le nom de la course", async () => {
  const race = line("Course A", { people: ["Anne", "Bob", "Cléo"], morePeople: 2 });
  serve({ lookup: previewOf({ upcoming: { total: 1, races: [race] } }) });
  const screen = await renderInvitation();

  await expect.element(screen.getByText("avec Anne, Bob, Cléo +2")).toBeVisible();
});

test("InvitationPage — aperçu : une ligne sans personne n'a pas de « avec »", async () => {
  serve({ lookup: previewOf({ upcoming: { total: 1, races: [line("Course A")] } }) });
  const screen = await renderInvitation();

  await expect.element(screen.getByText("Course A")).toBeVisible();
  await expect.element(screen.getByText(/^avec /)).not.toBeInTheDocument();
});

test("InvitationPage — aperçu : une course au mois dit « juin 2027 »", async () => {
  const race = line("Course du mois", { day: "2027-06-01", monthOnly: true });
  serve({ lookup: previewOf({ upcoming: { total: 1, races: [race] } }) });
  const screen = await renderInvitation();

  const item = screen.getByRole("listitem");
  const said = item.element().textContent;
  expect(said).toContain("juin 2027");
  expect(said).not.toContain("date à préciser");
});

test("InvitationPage — aperçu : « Tes prochaines courses (8) » puis « et 5 autres »", async () => {
  const races = [line("Course A"), line("Course B"), line("Course C")];
  serve({ lookup: previewOf({ upcoming: { total: 8, races } }) });
  const screen = await renderInvitation();

  await expect
    .element(screen.getByRole("heading", { level: 2, name: "Tes prochaines courses (8)" }))
    .toBeVisible();
  expect(screen.getByRole("listitem").elements()).toHaveLength(3);
  await expect.element(screen.getByText("et 5 autres")).toBeVisible();
});

test("InvitationPage — aperçu : « et 1 autre » pour un total de 4", async () => {
  const races = [line("Course A"), line("Course B"), line("Course C")];
  serve({ lookup: previewOf({ upcoming: { total: 4, races } }) });
  const screen = await renderInvitation();

  await expect.element(screen.getByText("et 1 autre", { exact: true })).toBeVisible();
});

test("InvitationPage — aperçu : pas de « et … » quand tout est montré", async () => {
  serve({ lookup: previewOf({ upcoming: { total: 1, races: [line("Course A")] } }) });
  const screen = await renderInvitation();

  await expect.element(screen.getByText("Course A")).toBeVisible();
  await expect.element(screen.getByText(/^et \d+ autre/)).not.toBeInTheDocument();
});

test("InvitationPage — aperçu : le groupe en une phrase, avec une course", async () => {
  serve({
    lookup: previewOf({
      upcoming: { total: 1, races: [line("Course A")] },
      group: [line("Hyrox Lyon", { day: "2027-01-18" })],
    }),
  });
  const screen = await renderInvitation();

  await expect
    .element(screen.getByText("Le groupe va aussi à Hyrox Lyon (18 janv.).", { exact: true }))
    .toBeVisible();
  // A plain paragraph: one heading only (the races of the person).
  expect(screen.getByRole("heading", { level: 2 }).elements()).toHaveLength(1);
});

test("InvitationPage — aperçu : le groupe en une phrase, avec trois courses", async () => {
  serve({
    lookup: previewOf({
      upcoming: { total: 1, races: [line("Course A")] },
      group: [
        line("Alpha", { day: "2027-01-18" }),
        line("Bravo", { day: "2027-02-01" }),
        line("Charlie", { day: "2027-06-01", monthOnly: true }),
      ],
    }),
  });
  const screen = await renderInvitation();

  await expect
    .element(
      screen.getByText(
        "Le groupe va aussi à Alpha (18 janv.), Bravo (1 févr.) et Charlie (juin 2027).",
        { exact: true },
      ),
    )
    .toBeVisible();
});

test("InvitationPage — aperçu : sans course de la personne, « Le groupe va à … »", async () => {
  serve({ lookup: previewOf({ group: [line("Hyrox Lyon", { day: "2027-01-18" })] }) });
  const screen = await renderInvitation();

  await expect
    .element(screen.getByText("Le groupe va à Hyrox Lyon (18 janv.).", { exact: true }))
    .toBeVisible();
  expect(screen.getByRole("heading", { level: 2 }).elements()).toHaveLength(0);
});

test("InvitationPage — aperçu : sans course du groupe, pas de phrase du groupe", async () => {
  serve({ lookup: previewOf({ upcoming: { total: 1, races: [line("Course A")] } }) });
  const screen = await renderInvitation();

  await expect.element(screen.getByText("Course A")).toBeVisible();
  await expect.element(screen.getByText(/Le groupe va/)).not.toBeInTheDocument();
});

test("InvitationPage — aperçu : rien du tout, le titre, la phrase et le formulaire", async () => {
  serve({ lookup: previewOf() });
  const screen = await renderInvitation();

  await expect.element(screen.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.element(screen.getByText(fr.auth.intro, { exact: true })).toBeVisible();
  await expect.element(email(screen)).toBeVisible();
  expect(screen.getByRole("heading", { level: 2 }).elements()).toHaveLength(0);
  expect(screen.getByRole("list").elements()).toHaveLength(0);
  await expect.element(screen.getByText(/Le groupe va/)).not.toBeInTheDocument();
});

test("InvitationPage — aperçu en anglais : le titre et la phrase du groupe", async () => {
  serve({
    lookup: previewOf({
      upcoming: { total: 2, races: [line("Course A")] },
      group: [line("Alpha", { day: "2027-01-18" }), line("Bravo", { day: "2027-02-01" })],
    }),
  });
  const screen = await renderInvitation({ languages: ["en"] });

  await expect
    .element(screen.getByRole("heading", { level: 2, name: "Your next races (2)" }))
    .toBeVisible();
  await expect.element(screen.getByText("and 1 more", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByText(/^The group is also going to Alpha \(.+\) and Bravo \(.+\)\.$/))
    .toBeVisible();
});

test("InvitationPage — aperçu en anglais : sans course de la personne", async () => {
  serve({ lookup: previewOf({ group: [line("Alpha", { day: "2027-01-18" })] }) });
  const screen = await renderInvitation({ languages: ["en"] });

  await expect.element(screen.getByText(/^The group is going to Alpha \(.+\)\.$/)).toBeVisible();
});

test("InvitationPage — aperçu : aucune ligne n'est un lien", async () => {
  serve({
    lookup: previewOf({
      upcoming: { total: 1, races: [line("Course A")] },
      group: [line("Course G")],
    }),
  });
  const screen = await renderInvitation();

  await expect.element(screen.getByText("Course A")).toBeVisible();
  expect(screen.getByRole("link").elements()).toHaveLength(0);
});

test("InvitationPage — la vérification part avec la langue de l'interface", async () => {
  serve({ lookup: previewOf() });
  const screen = await renderInvitation({ languages: ["en"] });

  await expect
    .element(screen.getByRole("heading", { level: 1 }))
    .toHaveTextContent(en.auth.invitedYou("Alex"));
  expect(send).toHaveBeenCalledWith(LOOKUP, {
    method: "POST",
    body: { token: "the-token", lang: "en" },
  });
});
