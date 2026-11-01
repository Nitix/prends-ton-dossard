import { describe, expect, test } from "vitest";

import { en } from "./en";
import { fr } from "./fr";

describe("status labels", () => {
  test("French", () => {
    expect(fr.status).toEqual({
      interested: "Intéressé",
      registered: "Inscrit",
      finished: "Terminé",
      dnf: "Abandon",
      dns: "Non partant",
      supporter: "Supporteur",
    });
  });

  test("English", () => {
    expect(en.status).toEqual({
      interested: "Interested",
      registered: "Registered",
      finished: "Finished",
      dnf: "DNF",
      dns: "DNS",
      supporter: "Supporter",
    });
  });
});

describe("supporter texts", () => {
  test("French", () => {
    expect(fr.participation.support).toBe("Je viens encourager");
    expect(fr.participation.supportOther).toBe("Vient encourager");
    expect(fr.participation.supportHint).toBe("Un supporteur vient encourager sans courir.");
    expect(fr.event.supportersTitle).toBe("Supporteurs");
  });

  test("English", () => {
    expect(en.participation.support).toBe("I'm coming to cheer");
    expect(en.participation.supportOther).toBe("Coming to cheer");
    expect(en.participation.supportHint).toBe("A supporter comes to cheer without running.");
    expect(en.event.supportersTitle).toBe("Supporters");
  });
});

describe("event and format texts", () => {
  test("French", () => {
    expect(fr.event.unconfirmed).toBe("non confirmé");
    expect(fr.event.addedBy("Alice")).toBe("Ajouté par Alice");
    expect(fr.event.dateRange("sam. 13 juin", "dim. 14 juin")).toBe(
      "du sam. 13 juin au dim. 14 juin",
    );
    expect(fr.format.max("10h")).toBe("max 10h");
    expect(fr.format.elevation("2 400 m")).toBe("2 400 m D+");
  });

  test("English", () => {
    expect(en.event.unconfirmed).toBe("not confirmed");
    expect(en.event.addedBy("Alice")).toBe("Added by Alice");
    expect(en.event.dateRange("Sat 13 Jun", "Sun 14 Jun")).toBe("Sat 13 Jun to Sun 14 Jun");
    expect(en.format.max("10h")).toBe("max 10h");
    expect(en.format.elevation("2,400 m")).toBe("2,400 m gain");
  });
});

describe("home texts", () => {
  test("French", () => {
    expect(fr.home.addedYou("Alice", "Trail 42 km")).toBe(
      "Alice a ajouté ta participation à « Trail 42 km »",
    );
    expect(fr.home.confirmFor("Trail des Crêtes")).toBe("Confirmer pour Trail des Crêtes");
    expect(fr.home.removeFor("Trail des Crêtes")).toBe("Retirer de Trail des Crêtes");
  });

  test("English", () => {
    expect(en.home.addedYou("Alice", "Trail 42 km")).toBe("Alice added you to “Trail 42 km”");
    expect(en.home.confirmFor("Trail des Crêtes")).toBe("Confirm for Trail des Crêtes");
    expect(en.home.removeFor("Trail des Crêtes")).toBe("Remove from Trail des Crêtes");
  });
});

describe("agenda texts", () => {
  test("French", () => {
    expect(fr.agenda.previous).toBe("Mois précédent");
    expect(fr.agenda.next).toBe("Mois suivant");
    expect(fr.agenda.day("dim. 14 juin", 0)).toBe("dim. 14 juin, aucun événement");
    expect(fr.agenda.day("dim. 14 juin", 1)).toBe("dim. 14 juin, 1 événement");
    expect(fr.agenda.day("dim. 14 juin", 3)).toBe("dim. 14 juin, 3 événements");
  });

  test("English", () => {
    expect(en.agenda.previous).toBe("Previous month");
    expect(en.agenda.next).toBe("Next month");
    expect(en.agenda.day("Sun 14 Jun", 0)).toBe("Sun 14 Jun, no events");
    expect(en.agenda.day("Sun 14 Jun", 1)).toBe("Sun 14 Jun, 1 event");
    expect(en.agenda.day("Sun 14 Jun", 3)).toBe("Sun 14 Jun, 3 events");
  });
});

describe("admin texts", () => {
  test("French", () => {
    expect(fr.admin.membersTitle).toBe("Membres");
    expect(fr.admin.stateInvited("sam. 7 nov. 2026")).toBe(
      "Invitation en attente · expire le sam. 7 nov. 2026",
    );
    expect(fr.admin.forRunner("Renommer", "Alice")).toBe("Renommer · Alice");
    expect(fr.admin.shareTitle.invite("Alice")).toBe("Lien d'invitation pour Alice");
    expect(fr.admin.shareTitle.reset("Alice")).toBe("Lien de réinitialisation pour Alice");
    expect(fr.admin.expires("sam. 7 nov. 2026")).toBe("Valable jusqu'au sam. 7 nov. 2026.");
    expect(fr.admin.share).toBe("Partager");
    expect(fr.admin.copy).toBe("Copier");
  });

  test("English", () => {
    expect(en.admin.membersTitle).toBe("Members");
    expect(en.admin.stateInvited("Sat 7 Nov 2026")).toBe(
      "Invitation pending · expires on Sat 7 Nov 2026",
    );
    expect(en.admin.forRunner("Rename", "Alice")).toBe("Rename · Alice");
    expect(en.admin.shareTitle.invite("Alice")).toBe("Invitation link for Alice");
    expect(en.admin.shareTitle.reset("Alice")).toBe("Reset link for Alice");
    expect(en.admin.expires("Sat 7 Nov 2026")).toBe("Valid until Sat 7 Nov 2026.");
    expect(en.admin.share).toBe("Share");
    expect(en.admin.copy).toBe("Copy");
  });
});

describe("avatar texts", () => {
  test("French", () => {
    expect(fr.avatar.title).toBe("Photo");
    expect(fr.avatar.titleFor("Sam")).toBe("Photo de Sam");
    expect(fr.avatar.change).toBe("Changer la photo");
    expect(fr.avatar.remove).toBe("Retirer la photo");
    expect(fr.avatar.preparing).toBe("Préparation de la photo…");
    expect(fr.avatar.saved).toBe("Photo enregistrée.");
    expect(fr.avatar.removed).toBe("Photo retirée.");
    expect(fr.avatar.decodeFailed).toBe(
      "Impossible de lire cette image. Choisis une photo JPEG, PNG ou WebP.",
    );
    expect(fr.errors.validation_file_size_limit).toBe("La photo est trop lourde : 5 Mo maximum.");
    expect(fr.errors.validation_invalid_mime_type).toBe(
      "Ce type d'image n'est pas accepté : JPEG, PNG ou WebP.",
    );
  });

  test("English", () => {
    expect(en.avatar.title).toBe("Photo");
    expect(en.avatar.titleFor("Sam")).toBe("Sam's photo");
    expect(en.avatar.change).toBe("Change the photo");
    expect(en.avatar.remove).toBe("Remove the photo");
    expect(en.avatar.preparing).toBe("Preparing the photo…");
    expect(en.avatar.saved).toBe("Photo saved.");
    expect(en.avatar.removed).toBe("Photo removed.");
    expect(en.avatar.decodeFailed).toBe(
      "This image cannot be read. Pick a JPEG, PNG or WebP photo.",
    );
    expect(en.errors.validation_file_size_limit).toBe("The photo is too big: 5 MB maximum.");
    expect(en.errors.validation_invalid_mime_type).toBe(
      "This image type is not accepted: JPEG, PNG or WebP.",
    );
  });
});

describe("track texts", () => {
  test("French", () => {
    expect(fr.format.gpx).toBe("Trace GPX");
    expect(fr.format.gpxRemove).toBe("Retirer la trace");
    expect(fr.format.gpxRead("42,2 km", "2 400 m")).toBe("Trace : 42,2 km, 2 400 m D+");
    expect(fr.format.gpxReadDistance("42,2 km")).toBe("Trace : 42,2 km");
    expect(fr.format.gpxRemoved).toBe("La trace sera retirée à l'enregistrement.");
    expect(fr.format.gpxReuse).toBe("Reprendre ces valeurs");
    expect(fr.format.routeUrl).toBe("Lien du parcours");
    expect(fr.format.gpxNotGpx).toBe("Ce fichier n'est pas une trace GPX.");
    expect(fr.format.gpxTooBig).toBe("La trace est trop lourde : 10 Mo maximum.");
    expect(fr.route.download).toBe("Télécharger la trace");
    expect(fr.route.open).toBe("Voir le parcours");
    expect(fr.form.traceFailed("Trail 42 km")).toBe(
      "L'événement est enregistré, mais la trace de Trail 42 km n'a pas pu être envoyée.",
    );
    expect(fr.form.traceFailedBecause("Trail 42 km", fr.format.gpxTooBig)).toBe(
      "L'événement est enregistré, mais la trace de Trail 42 km n'a pas pu être envoyée. La trace est trop lourde : 10 Mo maximum.",
    );
  });

  test("English", () => {
    expect(en.format.gpx).toBe("GPX track");
    expect(en.format.gpxRemove).toBe("Remove the track");
    expect(en.format.gpxRead("42.2 km", "2,400 m")).toBe("Track: 42.2 km, 2,400 m gain");
    expect(en.format.gpxReadDistance("42.2 km")).toBe("Track: 42.2 km");
    expect(en.format.gpxRemoved).toBe("The track will be removed when you save.");
    expect(en.format.gpxReuse).toBe("Use these values");
    expect(en.format.routeUrl).toBe("Course link");
    expect(en.format.gpxNotGpx).toBe("This file is not a GPX track.");
    expect(en.format.gpxTooBig).toBe("The track is too big: 10 MB at most.");
    expect(en.route.download).toBe("Download the track");
    expect(en.route.open).toBe("See the course");
    expect(en.form.traceFailed("Trail 42 km")).toBe(
      "The event is saved, but the track of Trail 42 km could not be sent.",
    );
    expect(en.form.traceFailedBecause("Trail 42 km", en.format.gpxTooBig)).toBe(
      "The event is saved, but the track of Trail 42 km could not be sent. The track is too big: 10 MB at most.",
    );
  });
});

describe("site name", () => {
  test("French", () => {
    expect(fr.common.appName).toBe("Prends ton dossard");
    expect(fr.admin.shareSubject.invite).toBe("Invitation sur Prends ton dossard");
    expect(fr.admin.shareSubject.reset).toBe("Nouveau mot de passe sur Prends ton dossard");
  });

  test("English", () => {
    expect(en.common.appName).toBe("Prends ton dossard");
    expect(en.admin.shareSubject.invite).toBe("Invitation to Prends ton dossard");
    expect(en.admin.shareSubject.reset).toBe("New password on Prends ton dossard");
  });
});

describe("offers texts", () => {
  test("French", () => {
    const o = fr.offers;
    expect(o.title).toEqual({ ride: "Covoiturage", lodging: "Logement" });
    expect(o.rideFrom("Lyon")).toBe("Départ de Lyon");
    expect(o.dates("sam. 13 juin", "dim. 14 juin")).toBe("du sam. 13 juin au dim. 14 juin");
    // In French 0 is singular, as 1 is.
    expect(o.taken(0, 4)).toBe("0 place prise sur 4");
    expect(o.taken(1, 4)).toBe("1 place prise sur 4");
    expect(o.taken(2, 4)).toBe("2 places prises sur 4");
    expect(o.unlimited(1)).toBe("1 personne, places non précisées");
    expect(o.unlimited(3)).toBe("3 personnes, places non précisées");
    expect([o.take.ride, o.take.lodging]).toEqual(["Je monte", "J'y dors"]);
    expect([o.leave.ride, o.leave.lodging]).toEqual(["Je descends", "Je n'y dors plus"]);
    expect(o.removeFor("Bob")).toBe("Retirer Bob");
    // The verb agrees with the number of people named.
    expect(o.deleteConfirm("Bob et Sam", 2)).toBe(
      "Supprimer cette offre ? Bob et Sam perdront leur place.",
    );
    expect(o.deleteConfirm("Bob", 1)).toBe("Supprimer cette offre ? Bob perdra sa place.");
    expect(o.deleteConfirmEmpty).toBe("Supprimer cette offre ?");
    expect(o.propose).toEqual({ ride: "Proposer une voiture", lodging: "Proposer un logement" });
    expect([o.edit, o.addSomeone, o.addSomeoneTitle]).toEqual([
      "Modifier",
      "Ajouter quelqu'un",
      "Ajouter quelqu'un",
    ]);
    expect(o.nobodyToAdd).toBe("Tout le monde a déjà une place.");
    const form = o.form;
    expect(form.place).toEqual({ ride: "Lieu de départ", lodging: "Nom ou adresse" });
    expect(form.seats).toEqual({ ride: "Places proposées", lodging: "Places (facultatif)" });
    expect(form.date).toEqual({ ride: "Jour du départ", lodging: "Arrivée" });
    expect([form.time, form.endDate, form.url, form.notes, form.save]).toEqual([
      "Heure de départ",
      "Départ",
      "Lien de l'annonce",
      "Notes",
      "Enregistrer",
    ]);
    expect(form.titleNew).toEqual({
      ride: "Proposer une voiture",
      lodging: "Proposer un logement",
    });
    expect(form.titleEdit).toBe("Modifier l'offre");
  });

  test("English", () => {
    const o = en.offers;
    expect(o.title).toEqual({ ride: "Carpooling", lodging: "Lodging" });
    expect(o.rideFrom("Lyon")).toBe("Leaving from Lyon");
    expect(o.dates("Sat 13 Jun", "Sun 14 Jun")).toBe("from Sat 13 Jun to Sun 14 Jun");
    expect(o.taken(0, 4)).toBe("0 of 4 seats taken");
    expect(o.taken(1, 1)).toBe("1 of 1 seat taken");
    expect(o.unlimited(1)).toBe("1 person, places not given");
    expect(o.unlimited(3)).toBe("3 people, places not given");
    expect([o.take.ride, o.take.lodging]).toEqual(["I'll ride", "I'll stay"]);
    expect([o.leave.ride, o.leave.lodging]).toEqual(["I'll leave the car", "I won't stay"]);
    expect(o.removeFor("Bob")).toBe("Remove Bob");
    expect(o.deleteConfirm("Bob and Sam")).toBe(
      "Delete this offer? Bob and Sam will lose their place.",
    );
    expect(o.deleteConfirmEmpty).toBe("Delete this offer?");
    expect(o.propose).toEqual({ ride: "Offer a car", lodging: "Offer lodging" });
    expect([o.edit, o.addSomeone, o.addSomeoneTitle]).toEqual([
      "Edit",
      "Add someone",
      "Add someone",
    ]);
    expect(o.nobodyToAdd).toBe("Everyone already has a place.");
    const form = o.form;
    expect(form.place).toEqual({ ride: "Leaving from", lodging: "Name or address" });
    expect(form.seats).toEqual({ ride: "Seats offered", lodging: "Places (optional)" });
    expect(form.date).toEqual({ ride: "Departure day", lodging: "Arrival" });
    expect([form.time, form.endDate, form.url, form.notes, form.save]).toEqual([
      "Departure time",
      "Departure",
      "Listing link",
      "Notes",
      "Save",
    ]);
    expect(form.titleNew).toEqual({ ride: "Offer a car", lodging: "Offer lodging" });
    expect(form.titleEdit).toBe("Edit the offer");
    expect(o.empty).toEqual({
      ride: "Nobody offers a car yet.",
      lodging: "Nobody offers lodging yet.",
    });
  });
});

describe("route texts", () => {
  test("French", () => {
    const r = fr.route;
    expect([r.title, r.map, r.zoomIn, r.zoomOut, r.profileLabel, r.start, r.finish]).toEqual([
      "Parcours",
      "Carte du parcours",
      "Zoom avant",
      "Zoom arrière",
      "Profil de dénivelé",
      "Départ",
      "Arrivée",
    ]);
    expect(r.summary("42,2 km", "2 400 m", "2 380 m")).toBe("42,2 km · 2 400 m D+ · 2 380 m D−");
    expect(r.altitude("450 m", "1 200 m")).toBe("altitude 450 m à 1 200 m");
    expect(r.unreadable).toBe("Cette trace n'a pas pu être lue.");
  });

  test("English", () => {
    const r = en.route;
    expect([r.title, r.map, r.zoomIn, r.zoomOut, r.profileLabel, r.start, r.finish]).toEqual([
      "Course",
      "Route map",
      "Zoom in",
      "Zoom out",
      "Elevation profile",
      "Start",
      "Finish",
    ]);
    expect(r.summary("42.2 km", "2,400 m", "2,380 m")).toBe("42.2 km · 2,400 m D+ · 2,380 m D−");
    expect(r.altitude("450 m", "1,200 m")).toBe("altitude 450 m to 1,200 m");
    expect(r.unreadable).toBe("This track could not be read.");
  });
});

describe("result texts", () => {
  test("the number of finishers has a name of its own, in both languages", () => {
    expect(fr.results.rankTotal).toBe("Nombre de classés");
    expect(en.results.rankTotal).toBe("Number of finishers");
  });
});

describe("install texts", () => {
  test("French", () => {
    expect(fr.install).toEqual({
      title: "Application",
      button: "Installer",
      ios: "Sur iPhone : touche Partager, puis « Sur l'écran d'accueil ».",
      other: "Ton navigateur propose l'installation depuis son menu.",
      done: "L'appli est installée.",
    });
  });

  test("English", () => {
    expect(en.install).toEqual({
      title: "App",
      button: "Install",
      ios: "On iPhone: tap Share, then “Add to Home Screen”.",
      other: "Your browser offers to install it from its menu.",
      done: "The app is installed.",
    });
  });
});

describe("runner texts", () => {
  test("the title of the page of a runner before its name is known", () => {
    expect(fr.runner.title).toBe("Coureur");
    expect(en.runner.title).toBe("Runner");
  });
});
