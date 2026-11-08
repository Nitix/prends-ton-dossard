import { createElement, Fragment, type ReactNode } from "react";

import { plural } from "./plural";

// The French dictionary is the reference. en.ts is typed against it
// (`satisfies Messages`), so a missing or extra key fails the type check.
// A text with a variable is a function; one that is put in a sentence with a
// link (see `home.commentOn`) takes nodes, and gives a node.
export const fr = {
  common: {
    appName: "Prends ton dossard",
    loading: "Chargement…",
    save: "Enregistrer",
    cancel: "Annuler",
    close: "Fermer",
    confirm: "Confirmer",
    remove: "Retirer",
    delete: "Supprimer",
    edit: "Modifier",
    retry: "Réessayer",
    offline: "Hors connexion",
  },
  nav: {
    home: "Accueil",
    list: "Liste",
    calendar: "Agenda",
    profile: "Profil",
    admin: "Admin",
    createEvent: "Créer un événement",
    // The accessible name of the tab bar.
    main: "Navigation principale",
  },
  // The title of each page, in the tab and for screen readers (see lib/usePageTitle): « <title> · Prends ton dossard ».
  titles: {
    home: "Accueil",
    listUpcoming: "Courses à venir",
    listPast: "Courses passées",
    calendar: (month: string) => `Agenda · ${month}`,
    stats: (year: number) => `Statistiques ${year}`,
    newEvent: "Nouvelle course",
    // The page of a race while it loads (and if it fails), and when there is no such race.
    race: "Course",
    raceNotFound: "Course introuvable",
    // The form of a race while it loads, and once it is there (the name is the race's).
    editLoading: "Modifier",
    edit: (name: string) => `Modifier · ${name}`,
    runner: "Coureur",
    profile: "Profil",
    settings: "Réglages",
    members: "Membres · Admin",
    raceTypes: "Types de course · Admin",
    duplicates: "Doublons · Admin",
    signIn: "Connexion",
    invitation: "Invitation",
    notFound: "Page introuvable",
  },
  auth: {
    signIn: "Se connecter",
    signingIn: "Connexion…",
    email: "Email",
    password: "Mot de passe",
    badCredentials: "Email ou mot de passe incorrect.",
    // The invitation page: a new account (welcome) or a new password (reset).
    welcome: (name: string) => `Bienvenue ${name}`,
    resetTitle: (name: string) => `Nouveau mot de passe pour ${name}`,
    passwordHint: "10 caractères minimum.",
    passwordConfirm: "Confirme le mot de passe",
    createAccount: "Créer mon compte",
    changePassword: "Changer le mot de passe",
    saving: "Enregistrement…",
    passkeyLogin: "Se connecter avec une clé d'accès",
    passkeyWaiting: "Vérification de la clé d'accès…",
    // The demo instance only (see features/auth/demo.ts): a button that signs in to the shared account, and what it warns about.
    demoEnter: "Entrer dans la démo",
    demoNote: "Démo : tout le monde partage ce compte, ce que tu fais reste visible.",
  },
  // The profile page (the runner of the user, as the others see them) and the
  // settings page it leads to: the name, the email and the password of the
  // account, then the passkeys (see `passkeys`).
  profile: {
    settings: "Réglages",
    backToProfile: "Retour au profil",
    // « Mes prochaines courses »: the races of the runner that are to come.
    upcoming: "Mes prochaines courses",
    noUpcoming: "Aucune course prévue.",
    // An account that has no runner (the super-admin of PocketBase): nothing to show of one.
    noRunner: "Ce compte n'a pas de coureur.",
    nameTitle: "Nom affiché",
    name: "Nom",
    nameHint: "C'est le nom que le groupe voit à côté de tes courses.",
    nameSaved: "Nom enregistré.",
    emailTitle: "Email",
    currentEmail: (email: string) => `Email actuel : ${email}`,
    newEmail: "Nouvel email",
    changeEmail: "Changer l'email",
    emailSaved: "Email modifié.",
    // Asked again for each change: it proves that the owner is at the keyboard.
    currentPassword: "Mot de passe actuel",
    passwordTitle: "Mot de passe",
    newPassword: "Nouveau mot de passe",
    passwordSaved: "Mot de passe modifié.",
    passwordSignInAgain: "Mot de passe modifié. Reconnecte-toi.",
    logout: "Se déconnecter",
  },
  // The photo of a runner: the section of the settings, the window of the admin, and what the picker says (see components/AvatarPicker.tsx).
  avatar: {
    title: "Photo",
    titleFor: (name: string) => `Photo de ${name}`,
    change: "Changer la photo",
    remove: "Retirer la photo",
    // While the browser reduces the photo and sends it.
    preparing: "Préparation de la photo…",
    saved: "Photo enregistrée.",
    removed: "Photo retirée.",
    // The browser cannot read the file (HEIC outside Safari, or not a picture): nothing is sent.
    decodeFailed: "Impossible de lire cette image. Choisis une photo JPEG, PNG ou WebP.",
  },
  passkeys: {
    title: "Mes clés d'accès",
    intro:
      "Une clé d'accès te connecte sans mot de passe, avec ton empreinte, ton visage ou le code de ton appareil.",
    empty: "Tu n'as pas encore de clé d'accès.",
    add: "Ajouter une clé d'accès",
    addTitle: "Nouvelle clé d'accès",
    addSubmit: "Créer la clé",
    name: "Nom de la clé",
    nameHint: "Pour la reconnaître : « iPhone » ou « PC du boulot », par exemple.",
    alreadyRegistered: "Cet appareil a déjà une clé d'accès pour ton compte.",
    added: "Clé d'accès ajoutée.",
    rename: "Renommer",
    renameTitle: "Renommer la clé",
    renamed: "Clé renommée.",
    removeTitle: "Supprimer la clé ?",
    removeWarning: (name: string) =>
      `La clé « ${name} » ne pourra plus te connecter. Tu pourras en ajouter une autre.`,
    removed: "Clé supprimée.",
    created: (date: string) => `Créée le ${date}`,
    lastUsed: (date: string) => `Utilisée le ${date}`,
    neverUsed: "Jamais utilisée",
  },
  // The calendar link of the settings page (see features/calendar): an address that a calendar app subscribes to.
  calendar: {
    title: "Agenda",
    create: "Créer mon lien d'agenda",
    help: "Ajoute-le comme abonnement dans ton agenda (Google Agenda, Apple Calendrier, Outlook).",
    copy: "Copier",
    copied: "Lien copié.",
    // When a link exists: it is shown when it is made, and again when asked for.
    exists: "Ton lien d'agenda est actif.",
    show: "Afficher le lien",
    // A link made before the server kept the address: it works, but it cannot be shown.
    legacy: "Ce lien ne peut plus être affiché : crée un nouveau lien.",
    // The button, and the title and the text of the window that asks first.
    renew: "Nouveau lien",
    renewHint: "L'ancien lien cessera de marcher.",
    remove: "Supprimer le lien",
    // The two links of the section: the races of the member, and the races of the group (with who goes).
    mine: "Mes courses",
    group: "Les courses du groupe",
    groupCreate: "Créer le lien des courses du groupe",
    groupHelp:
      "Toutes les courses où au moins un membre va, avec qui y va. Ce lien est secret : il donne les noms des membres.",
    groupExists: "Le lien des courses du groupe est actif.",
  },
  // The weather of the page of an event (see features/weather): from seven days before the race to its last day.
  weather: {
    title: "Météo prévue",
    loading: "Chargement de la météo…",
    failed: "La météo n'a pas pu être chargée.",
    // The place the forecast is for, said so that a mistake of the geocoding shows (`detail` may be empty).
    atPlace: (name: string, detail: string) => (detail ? `À ${name} (${detail})` : `À ${name}`),
    atTrack: (format: string) => `Au départ de la trace de « ${format} »`,
    noPlace: (query: string) => `Pas de météo : le lieu « ${query} » n'a pas été trouvé.`,
    // Before the window of the weather, and for a race with no day: said, not left blank. The date is already formatted.
    notYet: (from: string) => `La météo sera là à partir du ${from}, une semaine avant la course.`,
    noDay: "La météo viendra quand le jour de la course sera connu.",
    // The time is already formatted; a forecast that is not the last one the server could get says so.
    forecastAt: (time: string, stale: boolean) =>
      stale ? `Prévision de ${time}, pas à jour` : `Prévision de ${time}`,
    // « Données : Open-Meteo.com (CC BY 4.0) · lieu : GeoNames »: the name is a link.
    sourceBefore: "Données : ",
    sourceName: "Open-Meteo.com",
    sourceAfter: " (CC BY 4.0)",
    geonames: " · lieu : GeoNames",
    // One day, all already formatted: its date, the weather in words, the temperatures, the rain, the gusts.
    day: (
      date: string,
      label: string,
      tMin: string,
      tMax: string,
      chance: string,
      mm: string,
      gust: string,
    ) =>
      `${date} · ${label} · ${tMin} à ${tMax} °C · pluie ${chance} %, ${mm} mm · rafales ${gust} km/h`,
    // Under a millimetre: a few drops are not none.
    lessThanOneMm: "< 1",
    // The WMO codes in words (see labels.ts).
    kinds: {
      clear: "Ciel dégagé",
      partly: "Peu nuageux",
      overcast: "Couvert",
      fog: "Brouillard",
      drizzle: "Bruine",
      rain: "Pluie",
      heavyRain: "Forte pluie",
      freezingRain: "Pluie verglaçante",
      snow: "Neige",
      showers: "Averses",
      heavyShowers: "Fortes averses",
      snowShowers: "Averses de neige",
      storm: "Orage",
      hail: "Orage et grêle",
      unknown: "Temps inconnu",
    },
  },
  // The "Rappels" section of the settings page (see features/reminders): when to be warned before the registrations of a race open.
  reminders: {
    title: "Rappels",
    intro: "Avant l'ouverture des inscriptions des courses où tu es intéressé ou inscrit.",
    legend: "Me prévenir",
    day: "1 jour avant",
    hour: "1 heure avant",
    both: "1 jour et 1 heure avant",
    none: "Jamais",
    saved: "Rappels enregistrés.",
    noTime:
      "Sans heure d'ouverture connue, « 1 jour avant » arrive la veille à 9 h et « 1 heure avant » le jour même à 8 h.",
    whereTitle: "Où ils arrivent",
    where:
      "En notification sur les appareils activés ci-dessous, et en alarme dans ton agenda abonné (section « Agenda »). Google Agenda et Outlook ignorent souvent les alarmes d'un agenda abonné : les notifications sont plus sûres.",
  },
  // Notifications on this device, inside the "Rappels" section (see features/push).
  push: {
    title: "Notifications sur cet appareil",
    enable: "Activer sur cet appareil",
    enabled: "Notifications activées sur cet appareil.",
    disable: "Désactiver sur cet appareil",
    disabled: "Notifications désactivées sur cet appareil.",
    test: "Envoyer un essai",
    testSent: (sent: number) =>
      sent === 1 ? "Essai envoyé à 1 appareil." : `Essai envoyé à ${sent} appareils.`,
    testNone: "Aucun appareil n'a reçu l'essai.",
    testFailed: (failed: number) =>
      failed === 1 ? "1 appareil n'a pas répondu." : `${failed} appareils n'ont pas répondu.`,
    tooManyTests: "Trop d'essais à la suite : attends quelques secondes, puis réessaie.",
    dismissed: "Tu n'as pas répondu à la demande du navigateur : réessaie quand tu veux.",
    notReady:
      "Le navigateur n'est pas encore prêt pour les notifications : réessaie dans un instant.",
    chooseFirst: "Choisis d'abord quand être prévenu.",
    needsInstall:
      "Sur iPhone et iPad, les notifications ne marchent que dans l'appli installée (iOS 16.4 ou plus) : touche Partager, puis « Sur l'écran d'accueil », ouvre l'appli et reviens ici.",
    denied:
      "Les notifications sont bloquées pour ce site sur cet appareil : autorise-les dans les réglages du navigateur (ou de l'iPhone), puis reviens ici.",
    unsupported: "Ce navigateur ne peut pas recevoir de notifications.",
    unavailable: "Les notifications ne sont pas disponibles pour l'instant.",
    devicesTitle: "Mes appareils",
    noDevices: "Aucun appareil n'est activé pour l'instant.",
    thisDevice: "cet appareil",
    since: (date: string) => `depuis le ${date}`,
    lastReminder: (date: string) => `dernier rappel le ${date}`,
    neverReminded: "aucun rappel reçu",
    remove: "Retirer",
    // The name of the device is in the accessible name only, after the visible text.
    removeLabel: (label: string) => `Retirer ${label}`,
    // What a device is called in the list (see features/push/deviceLabel.ts).
    device: {
      iphone: "iPhone",
      ipad: "iPad",
      unknown: "Appareil",
      browserOn: (browser: string, system: string) => `${browser} sur ${system}`,
    },
  },
  // The "AI assistant" section of the settings page (see features/mcp): the personal tokens with which an assistant acts on the site as the member.
  mcp: {
    title: "Assistant IA (MCP)",
    intro:
      "Un jeton laisse un assistant IA (Claude Code, Claude Desktop…) faire sur le site ce que tu y fais, en ton nom, sans l'ouvrir. Tout ce qu'il fait est signé de ton nom, et il te demande ton accord avant de supprimer quoi que ce soit. Il ne peut rien de plus que toi : l'administration seulement si tu es admin, et jamais ton mot de passe ni ton email. Changer ton mot de passe ou ton email révoque tous tes jetons.",
    empty: "Aucun jeton pour l'instant.",
    created: (date: string) => `Créé le ${date}`,
    lastUsed: (date: string) => `Utilisé le ${date}`,
    neverUsed: "Jamais utilisé",
    // The name of the token is in the accessible name only: the buttons of a
    // list would otherwise sound the same.
    revoke: "Révoquer",
    revokeLabel: (name: string) => `Révoquer le jeton « ${name} »`,
    revokeTitle: "Révoquer le jeton ?",
    revokeWarning: (name: string) =>
      `L'assistant qui utilise « ${name} » n'aura plus accès au site.`,
    revoked: "Jeton révoqué.",
    create: "Nouveau jeton",
    limit: (max: number) => `Tu as déjà ${max} jetons : révoque-en un pour en créer un autre.`,
    // The window that makes a token: its name first, then the token, shown once.
    createTitle: "Nouveau jeton",
    name: "Nom du jeton",
    nameHint: "Pour le reconnaître : « Claude sur mon PC », par exemple.",
    createSubmit: "Créer le jeton",
    showOnce: "Copie ce jeton maintenant : il ne sera plus jamais affiché.",
    tokenLabel: "Jeton",
    copyToken: "Copier le jeton",
    tokenCopied: "Jeton copié.",
    claudeCode: "Pour Claude Code, lance cette commande dans un terminal :",
    commandLabel: "Commande",
    copyCommand: "Copier la commande",
    commandCopied: "Commande copiée.",
    otherClients: (url: string) =>
      `Pour un autre assistant : l'adresse est ${url}, avec l'en-tête Authorization: Bearer suivi du jeton.`,
    done: "J'ai copié le jeton",
  },
  // The "App" section of the settings page (see features/pwa): putting the site on the home screen.
  install: {
    title: "Application",
    button: "Installer",
    // Safari makes no offer to install: this is where to tap.
    ios: "Sur iPhone : touche Partager, puis « Sur l'écran d'accueil ».",
    // Where the browser offers it from its own menu.
    other: "Ton navigateur propose l'installation depuis son menu.",
    // Once the site has been installed, in the page that was open at the time.
    done: "L'appli est installée.",
  },
  // The appearance of the app on this device (see lib/theme.ts): the dark theme, chosen or following the phone.
  settings: {
    appearance: "Apparence",
    // The skin of the app (see skins/): its name in the picker comes from the skin itself.
    skin: "Thème",
    // Beside « Thème »: Auto, Clair, Sombre, for a theme that has both modes.
    mode: "Clair ou sombre",
    onlyLight: "Ce thème n'a qu'un mode clair.",
    onlyDark: "Ce thème n'a qu'un mode sombre.",
    // The switch of a theme whose background moves (see lib/ambient.ts), and what it does.
    animateBackground: "Animer le fond",
    animateBackgroundHint:
      "Les dessins du fond de ce thème bougent doucement. Sans effet si ton appareil demande moins d'animations.",
    // A few letters in the font of a theme, on its card.
    fontSample: "Aa",
    // The message when a theme chosen cannot be loaded (offline, and never chosen on this device): the page keeps the theme it had.
    // Said politely (a live region) while the look of a theme chosen loads: its card is checked at once.
    skinLoading: "Chargement du thème…",
    skinLoadFailed: "Ce thème n'a pas pu se charger : vérifie ta connexion.",
    // Online: the look is gone even after the page was reloaded, so it is not the connection.
    skinLoadFailedOnline: "Ce thème n'a pas pu se charger : recharge l'application.",
    themeAuto: "Auto (comme le système)",
    themeLight: "Clair",
    themeDark: "Sombre",
  },
  // The labels of the participation statuses.
  status: {
    interested: "Intéressé",
    registered: "Inscrit",
    finished: "Terminé",
    dnf: "Abandon",
    dns: "Non partant",
    supporter: "Supporteur",
  },
  // The event cards and the chips of the participants.
  event: {
    // The accessible name of the list of the chips of a format.
    participants: "Participants",
    // Read out, and not only drawn in dashes, for a participation that the runner has not confirmed.
    unconfirmed: "non confirmé",
    addedBy: (name: string) => `Ajouté par ${name}`,
    // An event of several days: both days are already formatted.
    dateRange: (from: string, to: string) => `du ${from} au ${to}`,
    // A race known by its month only: the month already formatted ("juin 2027"). `monthWhen` is the line that says its days; `monthLabel` is what a screen reader says of its chip.
    monthWhen: (month: string) => `${month} · date à préciser`,
    monthLabel: (month: string) => `${month}, date à préciser`,
    // After the title of a race known by its month in a calendar file.
    dateToBeSet: "date à préciser",
    // The page of an event (see features/events/EventPage.tsx).
    register: "S'inscrire sur le site officiel",
    nobody: "Personne pour l'instant.",
    // Under a participant on the page of an event: who added them, and that they have not agreed yet.
    addedByUnconfirmed: (name: string) => `ajouté par ${name} · non confirmé`,
    deleteTitle: "Supprimer l'événement ?",
    // Says everything the server deletes with the event: its comments and its offers go too, with the places taken in them.
    deleteWarning: (name: string) =>
      `« ${name} » sera supprimé, avec ses épreuves et leurs participations, ses commentaires, les voitures et les logements proposés, et les places prises dedans.`,
    // For a duplicate, a merge keeps the comments and the offers. `where` is the way to the page of the admin: "Admin > Doublons".
    deleteDuplicate: (where: string) =>
      `C'est un doublon ? Un admin peut le fusionner (${where}) : les commentaires, les voitures et les logements sont alors gardés.`,
    // Followed by what is lost with the event, already joined: "3 commentaires, 2 voitures et 1 logement".
    deleteContents: "Seront aussi supprimés :",
    deleteCounts: {
      comments: (n: number) =>
        `${n} ${plural("fr", n, { one: "commentaire", other: "commentaires" })}`,
      rides: (n: number) => `${n} ${plural("fr", n, { one: "voiture", other: "voitures" })}`,
      lodgings: (n: number) => `${n} ${plural("fr", n, { one: "logement", other: "logements" })}`,
    },
    // Followed by the names of the participants, already joined: "Alice, Bob et Sam".
    deleteParticipants: "Participants concernés :",
    deleted: "Événement supprimé.",
    // The section of the participations on the event alone, before the formats.
    interestedTitle: "Intéressés, format à choisir",
    // The section of the supporters of the event, after the formats, and the line of the cards that has their chips.
    supportersTitle: "Supporteurs",
    // A participation with no format yet, said in words (never by a colour alone) on the cards and on the home page.
    formatToChoose: "Format à choisir",
    // The summary of the closed list, at the bottom, of those who do not start: the count.
    nonStarters: (n: number) => `Non partants (${n})`,
    // The registration deadline, on the cards and on the page: the date is already formatted.
    registrationUntil: (date: string) => `Inscriptions jusqu'au ${date}`,
    // Said in words, never by a colour alone, once the deadline is over and the event is not.
    registrationClosed: "Inscriptions closes",
    // Next to the deadline of the page when it is a week away or less: "Inscriptions jusqu'au mer. 10 juin · plus que 3 jours".
    daysLeft: (n: number) =>
      n === 0 ? "dernier jour" : n === 1 ? "plus qu'un jour" : `plus que ${n} jours`,
    // The box that reminds a runner who is only interested to register, and its text: the date is already formatted.
    reminderTitle: "Rappel",
    startAt: (time: string) => `départ à ${time}`,
    reminder: (date: string) => `Pense à t'inscrire avant le ${date}.`,
    // The opening of the registration, before it: a start (said in the page's line, the chip of a card, the box of a runner who is
    // interested, and the home page), then the day (« le lun. 12 janv. » or « aujourd'hui »), then the time when there is one («  à 10:00 »).
    openingHero: "Ouverture des inscriptions",
    openingCard: "Ouverture",
    openingAside: "Les inscriptions ouvrent",
    openingTodo: "ouvre",
    openingToday: "aujourd'hui",
    openingOnDate: (date: string) => `le ${date}`,
    openingAt: (time: string) => `à ${time}`,
    // After the opening, in the page's line, when the event has a deadline: the date is already formatted.
    openingDeadline: (date: string) => `jusqu'au ${date}`,
    // The title of the opening in a calendar file: the name of the event is its own.
    openingCalendarTitle: (name: string) => `Ouverture des inscriptions : ${name}`,
    // The button that downloads a calendar file of the event, and the name of that file when the event's own name
    // has nothing left once the characters a file name cannot have are taken out (the extension is added).
    addToCalendar: "Ajouter à mon agenda",
    calendarFileName: "evenement",
  },
  // Sharing a race (see features/events/share.ts and ShareButton.tsx).
  share: {
    button: "Partager",
    title: "Partager la course",
    // After the month of a race known by its month only, in the text that is sent.
    monthWhen: (month: string) => `${month} (date à préciser)`,
    formats: (list: string) => `Épreuves : ${list}`,
    textLabel: "Texte à partager",
    copy: "Copier le texte",
    copied: "Texte copié.",
    copyFailed: "Le navigateur n'a pas pu copier : le texte est sélectionné, copie-le à la main.",
    whatsapp: "Envoyer sur WhatsApp",
    newTab: "(nouvel onglet)",
    signIn: "Le lien ne s'ouvre qu'après connexion : seuls les membres du groupe voient la course.",
  },
  // What a member does with the participations of an event (see features/participations).
  participation: {
    // The button of the page, and the title of its dialog.
    join: "J'y vais",
    joinTitle: "J'y vais",
    addSomeone: "Ajouter quelqu'un",
    addSomeoneTitle: "Ajouter quelqu'un",
    addSubmit: "Ajouter",
    runner: "Coureur",
    chooseRunner: "Choisis un coureur",
    format: "Épreuve",
    status: "Statut",
    everyoneThere: "Tout le monde est déjà sur toutes les épreuves.",
    alreadyThere: "Cette personne est déjà sur cette épreuve.",
    // The accessible name of the menu button of a participant.
    actionsFor: (name: string) => `Actions pour ${name}`,
    removeTitle: "Retirer la participation ?",
    removeWarning: (name: string, format: string) => `${name} ne sera plus sur « ${format} ».`,
    // The choice "Not decided yet" among the formats of « J'y vais » and « Ajouter quelqu'un »: the participation is on the event alone.
    undecided: "Pas encore décidé",
    // Under the status when it cannot be chosen: with no format, it is « Intéressé ».
    undecidedHint: "Sans épreuve, le statut est « Intéressé ». Tu choisiras l'épreuve plus tard.",
    // The choice « Je viens encourager » among the formats of « J'y vais » (and « Vient encourager » in « Ajouter quelqu'un »): the participation is on the event alone, as a supporter.
    support: "Je viens encourager",
    supportOther: "Vient encourager",
    // Under the status when it cannot be chosen: a supporter comes to cheer without running.
    supportHint: "Un supporteur vient encourager sans courir.",
    // Under the status of a race that has not started: the two choices that are missing.
    afterRaceHint: "Terminé et Abandon seront proposés le jour de la course.",
    // The item of the menu of a participation on the event alone, and the title of its dialog.
    chooseFormat: "Choisir l'épreuve",
    chooseFormatTitle: "Choisir l'épreuve",
  },
  // The result of a participation: entered in a dialog from its menu, shown on its row (see features/results).
  results: {
    // The items of the menu of a participation on a format.
    enter: "Saisir le résultat",
    edit: "Modifier le résultat",
    title: "Résultat",
    time: "Temps",
    // The three parts of a time: the unit written next to its field, and its name for a screen reader.
    hours: "h",
    minutes: "min",
    seconds: "s",
    hoursName: "heures",
    minutesName: "minutes",
    secondsName: "secondes",
    rank: "Classement",
    // Between the rank and the number of people ranked: "12e sur 340".
    rankOf: "sur",
    // The accessible name of the field of that number: « sur » alone says nothing to a screen reader, and the field is not in the legend's words.
    rankTotal: "Nombre de classés",
    note: "Note",
    noteHint: "Catégorie, nombre de boucles, raison d'un abandon…",
    // On the row: the rank is already an ordinal ("12e"); the number of people ranked is not always known.
    rankText: (rank: string, of?: string) => (of === undefined ? rank : `${rank} sur ${of}`),
    save: "Enregistrer",
    // The block of the home page: the races the user is registered for and that are over, whose result is to enter.
    toEnterTitle: "Résultats à saisir",
    // Its three buttons: the first opens the window of the result, the other two change the status at once.
    finished: "J'ai fini",
    dnf: "Abandon",
    dns: "Pas parti",
  },
  // The statistics of a year, worked out from the results (see features/stats).
  stats: {
    title: "Statistiques",
    yearTitle: (year: number) => `Statistiques ${year}`,
    // The accessible names of the two arrows around the year.
    previousYear: "Année précédente",
    nextYear: "Année suivante",
    // The headers of the columns of the tables (here, and the year by year of a runner).
    year: "Année",
    runner: "Coureur",
    finished: "Terminées",
    dnf: "Abandons",
    km: "Km",
    elevation: "D+",
    time: "Temps",
    empty: "Aucun résultat cette année.",
    // The link to the page, from the profile and from the list of the past events.
    link: "Statistiques",
  },
  // The page of a runner: what is to come, the years, and what was run (see features/runners).
  runner: {
    // The title of the page until the name of the runner is known.
    title: "Coureur",
    upcoming: "À venir",
    years: "Bilan par année",
    history: "Historique",
    noHistory: "Pas encore de résultat.",
  },
  // The comments of an event, at the bottom of its page (see features/comments).
  comments: {
    // The title while the comments load or fail to load (the count is not known), and with the count.
    heading: "Commentaires",
    title: (n: number) => `Commentaires (${n})`,
    empty: "Pas encore de commentaire.",
    newLabel: "Ton commentaire",
    send: "Envoyer",
    edit: "Modifier",
    // The name of the field where a comment is edited: it is not the name of the button that opened it.
    editLabel: "Modifier ton commentaire",
    save: "Enregistrer",
    cancel: "Annuler",
    remove: "Supprimer",
    removeConfirm: "Supprimer ce commentaire ?",
    // Next to the date of a comment that was changed after it was written.
    edited: "modifié",
    // The help under the field: the keys that send the comment.
    sendHint: "Ctrl+Entrée pour envoyer",
  },
  // The carpooling and the lodging of an event: the offers of places, and who has taken one (see features/offers).
  offers: {
    title: { ride: "Covoiturage", lodging: "Logement" },
    empty: {
      ride: "Personne ne propose de voiture pour l'instant.",
      lodging: "Personne ne propose de logement pour l'instant.",
    },
    // Where a car leaves from: "Départ de Lyon, Part-Dieu".
    rideFrom: (place: string) => `Départ de ${place}`,
    // The days of a lodging, already formatted: "du sam. 13 juin au dim. 14 juin".
    dates: (from: string, to: string) => `du ${from} au ${to}`,
    seeAd: "Voir l'annonce",
    // The places taken, and in words whether it is full: "2 places prises sur 4" ("0 place prise", in French 0 is singular).
    taken: (n: number, seats: number) =>
      `${n} ${plural("fr", n, { one: "place prise", other: "places prises" })} sur ${seats}`,
    // A lodging that does not say how many people it takes: the people are counted, not the places.
    unlimited: (n: number) =>
      `${n} ${plural("fr", n, { one: "personne", other: "personnes" })}, places non précisées`,
    full: "Complet",
    take: { ride: "Je monte", lodging: "J'y dors" },
    leave: { ride: "Je descends", lodging: "Je n'y dors plus" },
    // The button of a person of an offer: its text is its accessible name.
    removeFor: (name: string) => `Retirer ${name}`,
    delete: "Supprimer",
    // The question of the window that deletes an offer, with the people who lose their place (the names are already joined: "Bob et Sam"; `n` of them, for the verb).
    deleteConfirm: (names: string, n: number) =>
      n === 1
        ? `Supprimer cette offre ? ${names} perdra sa place.`
        : `Supprimer cette offre ? ${names} perdront leur place.`,
    deleteConfirmEmpty: "Supprimer cette offre ?",
    propose: { ride: "Proposer une voiture", lodging: "Proposer un logement" },
    edit: "Modifier",
    addSomeone: "Ajouter quelqu'un",
    addSomeoneTitle: "Ajouter quelqu'un",
    nobodyToAdd: "Tout le monde a déjà une place.",
    // The form that offers a car or a lodging, or changes the offer.
    form: {
      place: { ride: "Lieu de départ", lodging: "Nom ou adresse" },
      seats: { ride: "Places proposées", lodging: "Places (facultatif)" },
      date: { ride: "Jour du départ", lodging: "Arrivée" },
      time: "Heure de départ",
      endDate: "Départ",
      url: "Lien de l'annonce",
      notes: "Notes",
      save: "Enregistrer",
      titleNew: { ride: "Proposer une voiture", lodging: "Proposer un logement" },
      titleEdit: "Modifier l'offre",
    },
  },
  // The measures of a format, next to its name (see features/events/formatName.ts).
  format: {
    // The cut-off time, the duration already formatted: "max 10h".
    max: (duration: string) => `max ${duration}`,
    // The elevation gain, the height already formatted: "2 400 m D+".
    elevation: (height: string) => `${height} D+`,
    // The label of the field of the price of a format, in the form.
    price: "Prix (€)",
    // The track of a format in the form: the file, what is read in it, what to do with it, the link.
    gpx: "Trace GPX",
    gpxRemove: "Retirer la trace",
    // The distance and the elevation gain of the chosen file, already formatted: "Trace : 42,2 km, 2 400 m D+".
    gpxRead: (km: string, gain: string) => `Trace : ${km}, ${gain} D+`,
    // A file with no altitude: only its distance is said, and reused.
    gpxReadDistance: (km: string) => `Trace : ${km}`,
    // Under the field of a track that is taken off, with the way back.
    gpxRemoved: "La trace sera retirée à l'enregistrement.",
    gpxReuse: "Reprendre ces valeurs",
    routeUrl: "Lien du parcours",
    // What the server refuses in the file of a track (see translateFieldError).
    gpxNotGpx: "Ce fichier n'est pas une trace GPX.",
    gpxTooBig: "La trace est trop lourde : 10 Mo maximum.",
  },
  // The track of a race: its numbers, and the two drawings (see features/route).
  route: {
    title: "Parcours",
    // The distance, the elevation gain and loss, already formatted: "42,2 km · 2 400 m D+ · 2 380 m D−".
    summary: (km: string, gain: string, loss: string) => `${km} · ${gain} D+ · ${loss} D−`,
    // The lowest and the highest altitudes, already formatted: "altitude 450 m à 1 200 m".
    altitude: (min: string, max: string) => `altitude ${min} à ${max}`,
    // The accessible name of the map of the track (the numbers are written beside it), and its two zoom buttons.
    map: "Carte du parcours",
    zoomIn: "Zoom avant",
    zoomOut: "Zoom arrière",
    // The hints of the map: the wheel alone scrolls the page (the key is Ctrl, or ⌘ on Apple devices), and on a touch screen one finger does too.
    wheelHint: (key: string) => `${key} + molette pour zoomer`,
    fingersHint: "Deux doigts pour déplacer la carte",
    // What describes the map to a screen reader (visually hidden).
    mapHelp: (key: string) => `Boutons + et −, ${key} + molette ou deux doigts pour zoomer.`,
    // The accessible name of the profile, which the page completes with the numbers.
    profileLabel: "Profil de dénivelé",
    // The legend of the colours of the profile, which are the steepness of the slope.
    slope: "Pente",
    // The cursor that runs along the profile (by finger, pointer or arrow keys), and what it reads, already formatted: "2,4 km, altitude 812 m, pente 12 %".
    profileCursor: "Position sur le profil",
    profileReading: (km: string, altitude: string, slope: string) =>
      `${km}, altitude ${altitude}, pente ${slope}`,
    // Zooming on a portion of the profile: the three buttons (text, then accessible name), the portion in words (the kilometers already formatted: "Du km 12,4 au km 18,0"), and the help under the profile.
    zoomProfileIn: "Zoomer",
    zoomProfileInLabel: "Zoomer sur le profil",
    zoomProfileOut: "Dézoomer",
    zoomProfileOutLabel: "Dézoomer le profil",
    zoomProfileAll: "Vue entière",
    zoomProfileAllLabel: "Vue entière du profil",
    profileWhole: "Profil entier",
    profileRange: (from: string, to: string) => `Du km ${from} au km ${to}`,
    profileHelpFine: "Glisse sur le profil pour zoomer sur une portion.",
    profileHelpCoarse: "Écarte deux doigts sur le profil pour zoomer.",
    // What the two marks of the map stand for.
    start: "Départ",
    finish: "Arrivée",
    unreadable: "Cette trace n'a pas pu être lue.",
    // In the place of the map when it cannot be loaded (a first visit with no network, or a file that a deploy replaced).
    mapUnavailable: "La carte n'est pas disponible pour l'instant.",
    // The links of the course: the file of the track, and the page of the course on a website.
    download: "Télécharger la trace",
    open: "Voir le parcours",
  },
  // The form that creates or edits an event and its formats (see features/events/EventForm.tsx).
  form: {
    createTitle: "Créer un événement",
    editTitle: "Modifier l'événement",
    name: "Nom de l'événement",
    location: "Lieu",
    locationHint: "Une ville ou un lieu.",
    startDate: "Date de début",
    // Under the start date: the days of the event, which the dates of its formats make (there is no end date to fill in). The days come written ("sam. 29 nov.").
    periodOneDay: (day: string) => `Un jour : ${day}`,
    periodRange: (from: string, to: string) =>
      `Du ${from} au ${to}, d'après les dates des épreuves`,
    // After the line above, when saving would change the end the event has now: nothing is lost without being said.
    periodWas: (from: string, to: string) => `(avant : du ${from} au ${to})`,
    // After the line above, when the days are more than two weeks apart: a year typed wrong in the date of a format makes a year-long event.
    periodLong: "Plus de deux semaines : vérifie les dates des épreuves.",
    // Just above « Enregistrer » when saving would end the event earlier (the days come written, "sam. 13 juin"): the days are lost, and the way to keep them is said.
    periodShortens: (from: string, to: string) =>
      `Enregistrer raccourcit l'événement (avant : du ${from} au ${to}). Pour garder ces jours, donne sa date à l'épreuve du dernier jour.`,
    registrationUrl: "Lien pour s'inscrire",
    registrationUrlHint: "Facultatif : l'adresse de la page d'inscription.",
    registrationDeadline: "Date limite d'inscription",
    registrationOpening: "Ouverture des inscriptions",
    registrationOpeningTime: "Heure d'ouverture",
    registrationOpeningTimeHint: "Facultative, à l'heure de Paris.",
    // Read with the time field while it is disabled: a time needs a day.
    registrationOpeningTimeNeedsDay: "Choisis d'abord le jour de l'ouverture.",
    // Under the start date: the box that says the day is not known, and the month to give instead.
    dayUnknown: "Le jour n'est pas encore connu",
    month: "Mois",
    periodMonth: (month: string) => `${month}, date à préciser`,
    deadlineAfterMonthEnd:
      "La date limite d'inscription ne peut pas être après la fin du mois de la course.",
    openingAfterMonthEnd:
      "L'ouverture des inscriptions ne peut pas être après la fin du mois de la course.",
    formatDatesLater: "Les épreuves auront leur date quand le jour sera connu.",
    notes: "Notes",
    formatsTitle: "Épreuves",
    // The title of the group of fields of a format, from 1.
    formatTitle: (n: number) => `Épreuve ${n}`,
    formatName: "Nom de l'épreuve",
    formatNameHint:
      "Facultatif : sinon il est fait du type et de la distance, « Trail 42 km » par exemple.",
    raceType: "Type de course",
    chooseRaceType: "Choisis un type",
    // Above the measures the type of the format uses. The others are in a closed section under them, so it does not count them.
    measuresHint: "Au moins une mesure est obligatoire : distance, durée ou temps max.",
    // The summary of the closed section, which says what it holds: the measures, by name (below) and as a list, in the order of the form ("Options avancées : distance, D+ et durée").
    moreOptions: (measures: string) => `Options avancées : ${measures}`,
    // A measure by name, in the middle of a sentence.
    measureNames: {
      distance: "distance",
      elevation: "D+",
      duration: "durée",
      time_limit: "temps max",
    },
    distance: "Distance (km)",
    duration: "Durée (course au temps)",
    timeLimit: "Temps max",
    // The two parts of a duration: spoken, and written next to the field.
    hours: "heures",
    minutes: "minutes",
    hoursUnit: "h",
    minutesUnit: "min",
    elevation: "Dénivelé positif (m)",
    formatDate: "Date de l'épreuve",
    formatDateHint: "Seulement si ce n'est pas le premier jour.",
    formatStartTime: "Heure de départ",
    formatStartTimeHint: "Facultative. Elle donne la météo de l'heure du départ.",
    addFormat: "Ajouter une épreuve",
    // Next to « Retirer » on a format that already has runners: the server deletes their participations with it.
    formatHasParticipants: (n: number) =>
      n === 1
        ? "1 personne est sur cette épreuve : la retirer supprime aussi sa participation."
        : `${n} personnes sont sur cette épreuve : la retirer supprime aussi leurs participations.`,
    join: "Je participe",
    // Above the events that may be the one being typed.
    duplicateQuestion: "Cet événement existe peut-être déjà :",
    saved: "Événement enregistré.",
    // The event is saved, but not the track of these formats (already named and joined: "Trail 42 km et Route 10 km").
    traceFailed: (names: string) =>
      `L'événement est enregistré, mais la trace de ${names} n'a pas pu être envoyée.`,
    // The same, when the server said why (the message of its refusal, which ends with a full stop).
    traceFailedBecause: (names: string, reason: string) =>
      `L'événement est enregistré, mais la trace de ${names} n'a pas pu être envoyée. ${reason}`,
  },
  // The filters of the list and of the calendar.
  filters: {
    title: "Filtres",
    person: "Personne",
    everyone: "Tout le monde",
    me: "Moi",
    type: "Type de course",
    allTypes: "Tous les types",
    period: "Période",
    upcoming: "À venir",
    past: "Passées",
  },
  // The calendar (see features/agenda).
  agenda: {
    // The two arrows next to the month.
    previous: "Mois précédent",
    next: "Mois suivant",
    // The name of the button of a day: its date, already formatted, and its events.
    day: (date: string, count: number) =>
      `${date}, ${count === 0 ? "aucun événement" : count === 1 ? "1 événement" : `${count} événements`}`,
    // Under the grid, on a phone: nothing chosen yet, or nothing on the day chosen.
    selectDay: "Touche un jour pour voir ses événements.",
    dayEmpty: "Aucun événement ce jour-là.",
    // The block above the grid: the races of the month whose day is not known.
    monthToBeSet: "Ce mois-ci, date à préciser",
  },
  list: {
    empty: "Aucun événement à afficher.",
    emptyHint: "Change les filtres, ou crée un événement avec le bouton +.",
  },
  // The home page (see features/home).
  home: {
    // The participations that others added for the user, who has not agreed yet.
    pendingTitle: "À confirmer",
    // The format is already named: "Trail 42 km".
    addedYou: (name: string, format: string) => `${name} a ajouté ta participation à « ${format} »`,
    // The accessible names of the two buttons of a row: the visible text is « Confirmer » and « Retirer ».
    confirmFor: (event: string) => `Confirmer pour ${event}`,
    removeFor: (event: string) => `Retirer de ${event}`,
    confirmed: "Participation confirmée.",
    removed: "Participation retirée.",
    // The races the user is interested in and has not registered for yet, while they still can.
    todoTitle: "Inscriptions à faire",
    // The deadline, the date being formatted already: « avant le mer. 10 juin ».
    todoBefore: (date: string) => `avant le ${date}`,
    // The link to the official site, and the button that says it is done (the status becomes « Inscrit »).
    todoRegister: "S'inscrire",
    todoDone: "Je suis inscrit",
    upcomingTitle: "Mes prochaines courses",
    upcomingEmpty: "Aucune course à venir. Ouvre un événement et touche « J'y vais ».",
    groupTitle: "Bientôt dans le groupe",
    groupEmpty: "Personne n'est encore inscrit à un événement à venir.",
    // The last comments of all the events. The event is a link, so both are nodes: "Alice sur Trail des Crêtes".
    latestCommentsTitle: "Derniers commentaires",
    commentOn: (name: ReactNode, event: ReactNode): ReactNode =>
      createElement(Fragment, null, name, " sur ", event),
    // The banner that suggests a passkey (the text under it is `passkeys.intro`).
    passkeyTitle: "Ajoute une clé d'accès",
    passkeyLink: "Ajouter dans mes réglages",
    passkeyDismiss: "Masquer",
  },
  // The admin pages (see features/admin).
  admin: {
    membersTitle: "Membres",
    addRunner: "Ajouter un coureur",
    empty: "Aucun coureur pour l'instant.",
    // The state of a runner, in the list. An account adds its role after a dot: « Actif · Admin ».
    stateNoAccount: "Sans compte",
    stateInvited: (date: string) => `Invitation en attente · expire le ${date}`,
    stateActive: "Actif",
    stateDisabled: "Désactivé",
    resetPending: (date: string) => `Lien de réinitialisation en attente · expire le ${date}`,
    roles: { member: "Membre", admin: "Admin" },
    // The accessible name of an action of a row: its text, then the runner it is about.
    forRunner: (action: string, name: string) => `${action} · ${name}`,
    rename: "Renommer",
    invite: "Inviter",
    regenerate: "Régénérer l'invitation",
    revokeInvite: "Révoquer l'invitation",
    revokeReset: "Révoquer le lien",
    resetLink: "Lien de réinitialisation",
    makeAdmin: "Passer admin",
    removeAdmin: "Retirer admin",
    disable: "Désactiver",
    enable: "Réactiver",
    passkeys: "Clés d'accès",
    // Creating, renaming and deleting a runner.
    runnerName: "Nom du coureur",
    runnerNameHint: "Le nom que le groupe voit à côté des courses.",
    createTitle: "Nouveau coureur",
    createSubmit: "Ajouter",
    created: "Coureur ajouté.",
    renameTitle: "Renommer le coureur",
    renamed: "Coureur renommé.",
    deleteTitle: "Supprimer le coureur ?",
    deleteWarning: (name: string) => `« ${name} » sera supprimé.`,
    deleted: "Coureur supprimé.",
    // Making a link: an invitation (with a role) or a reset.
    inviteTitle: (name: string) => `Inviter ${name}`,
    regenerateTitle: (name: string) => `Nouvelle invitation pour ${name}`,
    inviteIntro: "La personne choisira son email et son mot de passe en ouvrant le lien.",
    resetTitle: (name: string) => `Réinitialiser le mot de passe de ${name}`,
    resetIntro:
      "Le lien permet de choisir un nouveau mot de passe. Les sessions ouvertes du compte sont fermées dès qu'il est utilisé.",
    regenerateWarning: "L'ancien lien ne fonctionnera plus.",
    role: "Rôle donné à la création du compte",
    createLink: "Créer le lien",
    creating: "Création…",
    // The dialog that shows the link, once made.
    shareTitle: {
      invite: (name: string) => `Lien d'invitation pour ${name}`,
      reset: (name: string) => `Lien de réinitialisation pour ${name}`,
    },
    shareIntro: {
      invite: (name: string) => `Envoie ce lien à ${name} : il lui permet de créer son compte.`,
      reset: (name: string) =>
        `Envoie ce lien à ${name} : il lui permet de choisir un nouveau mot de passe.`,
    },
    // The date is already formatted.
    expires: (date: string) => `Valable jusqu'au ${date}.`,
    shareOnce:
      "Ce lien ne sera plus affiché une fois cette fenêtre fermée : copie-le ou partage-le maintenant.",
    link: "Lien",
    share: "Partager",
    copy: "Copier",
    copied: "Lien copié.",
    copyFailed: "Copie impossible. Sélectionne le lien et copie-le à la main.",
    shareFailed: "Le partage a échoué. Copie le lien à la place.",
    // The title of what the share sheet of the phone sends (the subject of an email, for instance).
    shareSubject: {
      invite: "Invitation sur Prends ton dossard",
      reset: "Nouveau mot de passe sur Prends ton dossard",
    },
    // Revoking a link that is waiting to be used.
    revoke: {
      invite: {
        title: "Révoquer l'invitation ?",
        warning: (name: string) => `Le lien d'invitation de ${name} ne fonctionnera plus.`,
        done: "Invitation révoquée.",
      },
      reset: {
        title: "Révoquer le lien ?",
        warning: (name: string) => `Le lien de réinitialisation de ${name} ne fonctionnera plus.`,
        done: "Lien révoqué.",
      },
    },
    revokeConfirm: "Révoquer",
    // Roles and deactivation.
    demoteTitle: "Retirer le rôle admin ?",
    demoteWarning: (name: string) => `${name} ne pourra plus gérer les membres.`,
    roleChanged: "Rôle modifié.",
    disableTitle: "Désactiver le compte ?",
    disableWarning: (name: string) =>
      `${name} ne pourra plus se connecter, et ses sessions ouvertes sont fermées tout de suite. Tu pourras réactiver le compte.`,
    disabledDone: "Compte désactivé.",
    enabledDone: "Compte réactivé.",
    // The passkeys of an account.
    passkeysTitle: (name: string) => `Clés d'accès de ${name}`,
    passkeysIntro: (name: string) =>
      `Ces clés permettent à ${name} de se connecter sans mot de passe.`,
    passkeysEmpty: "Aucune clé d'accès.",
    passkeyRemoveWarning: (key: string, name: string) =>
      `${name} ne pourra plus se connecter avec la clé « ${key} ».`,
    // The menu of the admin pages, whose links are named after the pages (`membersTitle`, `typesTitle`, `duplicatesTitle`).
    adminNav: "Administration",
    // The race types page.
    typesTitle: "Types de course",
    addType: "Ajouter un type",
    typesEmpty: "Aucun type de course pour l'instant.",
    typeLabel: "Nom du type",
    typeLabelHint:
      "Par exemple « Trail » ou « Route ». Deux types ne peuvent pas avoir le même nom, majuscules ou non.",
    typeExists: "Un type porte déjà ce nom.",
    createTypeTitle: "Nouveau type",
    typeCreated: "Type ajouté.",
    renameTypeTitle: "Renommer le type",
    typeRenamed: "Type renommé.",
    deleteTypeTitle: "Supprimer le type ?",
    deleteTypeWarning: (label: string) =>
      `« ${label} » sera supprimé. Un type que des épreuves utilisent encore ne peut pas l'être.`,
    typeDeleted: "Type supprimé.",
    // The measures of a race type: which fields the format form shows first (see features/admin/MeasuresDialog).
    measures: "Mesures",
    measuresTitle: (label: string) => `Mesures de « ${label} »`,
    measuresHint: "Les champs que le formulaire d'une épreuve montre d'abord pour ce type.",
    measuresNone: "Garde au moins une mesure.",
    measuresSaved: "Mesures enregistrées.",
    // The accessible name of an action of a row: its text, then what the row is.
    forItem: (action: string, name: string) => `${action} · ${name}`,
    // The duplicates page: merging two events, or two formats of one event.
    duplicatesTitle: "Doublons",
    duplicatesIntro:
      "Deux membres ont ajouté le même événement, ou la même épreuve ? Fusionne-les : tout est regroupé sur celui que tu gardes.",
    mergeMode: "Que veux-tu fusionner ?",
    modeEvents: "Deux événements",
    modeFormats: "Deux épreuves",
    firstEvent: "Premier événement",
    secondEvent: "Second événement",
    // The event whose two formats are merged.
    theEvent: "Événement",
    searchEvent: "Rechercher un événement",
    searchEventHint: "Tape une partie de son nom.",
    noEventFound: "Aucun événement trouvé.",
    changeChoice: "Changer",
    firstFormat: "Première épreuve",
    secondFormat: "Seconde épreuve",
    chooseFormat: "Choisis une épreuve",
    needTwoFormats: "Cet événement n'a pas deux épreuves à fusionner.",
    keep: { events: "Événement à garder", formats: "Épreuve à garder" },
    keepHint: {
      events:
        "Les épreuves de l'autre événement passent sur celui-ci, puis l'autre événement est supprimé.",
      formats:
        "Les participations de l'autre épreuve passent sur celle-ci, puis l'autre épreuve est supprimée.",
    },
    preview: "Aperçu",
    previewTitle: "Ce que la fusion ferait",
    mergeNothing: {
      events: "Rien à déplacer : l'autre événement est simplement supprimé.",
      formats: "Rien à déplacer : l'autre épreuve est simplement supprimée.",
    },
    // What a merge does, a line per kind of change. The number comes first: "2 épreuves déplacées".
    mergeCount: {
      movedFormats: { one: "épreuve déplacée", other: "épreuves déplacées" },
      movedParticipations: { one: "participation déplacée", other: "participations déplacées" },
      droppedParticipations: {
        one: "participation en double supprimée",
        other: "participations en double supprimées",
      },
      clearedFormatDates: {
        one: "date d'épreuve effacée (hors des dates de l'événement)",
        other: "dates d'épreuve effacées (hors des dates de l'événement)",
      },
      movedComments: { one: "commentaire déplacé", other: "commentaires déplacés" },
      movedOffers: { one: "offre déplacée", other: "offres déplacées" },
    },
    merge: "Fusionner",
    mergeConfirmTitle: {
      events: "Fusionner ces événements ?",
      formats: "Fusionner ces épreuves ?",
    },
    // The two sides of the merge, each already described on one line.
    keptLine: (description: string) => `Gardé : ${description}`,
    removedLine: (description: string) => `Supprimé : ${description}`,
    mergeIrreversible: "La fusion est définitive.",
    mergeConfirm: "Fusionner définitivement",
    merged: "Fusion terminée.",
    // What the codes of the server do not say well enough here.
    rateLimited: "Trop de demandes. Attends une minute, puis réessaie.",
    kindMismatch:
      "Le compte de ce coureur a changé entre-temps. La liste vient d'être mise à jour : réessaie.",
  },
  // One message per error code (see ./errors.ts), plus the generic one. The
  // keys are the codes themselves.
  errors: {
    generic: "Une erreur est survenue. Réessaie dans un instant.",
    invitation_invalid: "Ce lien a expiré ou a déjà été utilisé. Demande-en un nouveau à l'admin.",
    invitation_kind_mismatch:
      "Ce lien ne permet pas cette opération. Demande-en un nouveau à l'admin.",
    email_taken: "Cet email est déjà utilisé.",
    email_invalid: "Cet email n'est pas valide.",
    wrong_password: "Mot de passe incorrect.",
    password_too_short: "Le mot de passe est trop court (10 caractères minimum).",
    password_mismatch: "Les deux mots de passe sont différents.",
    last_admin: "Il doit toujours rester au moins un admin.",
    runner_has_participations:
      "Impossible de supprimer ce coureur : il a encore des participations.",
    runner_has_account:
      "Impossible de supprimer ce coureur : il a un compte. Désactive le compte à la place.",
    race_type_in_use: "Impossible de supprimer ce type : des épreuves l'utilisent encore.",
    date_invalid: "Cette date n'est pas valide.",
    end_before_start: "La date de fin est avant la date de début.",
    registration_deadline_after_start:
      "La date limite d'inscription doit être au plus tard le jour du début.",
    registration_opening_after_start:
      "L'ouverture des inscriptions doit être au plus tard le jour du début.",
    registration_opening_after_deadline:
      "L'ouverture des inscriptions doit être au plus tard la date limite.",
    format_date_month: "Une course dont seul le mois est connu n'a pas de date d'épreuve.",
    format_time_month: "Une épreuve d'une course au mois n'a pas d'heure de départ.",
    month_start_invalid: "Pour une course dont seul le mois est connu, la date est le 1er du mois.",
    format_date_out_of_range:
      "La date de l'épreuve doit être comprise dans les dates de l'événement.",
    format_other_event: "Cette épreuve appartient à un autre événement.",
    format_measure_required: "Indique au moins une distance, une durée ou un temps max.",
    price_invalid: "Le prix se donne au centime près.",
    format_required: "Il faut choisir une épreuve.",
    status_before_race: "La course n'a pas encore eu lieu.",
    supporter_with_format: "Un supporteur ne court pas d'épreuve.",
    rank_above_total: "Le classement dépasse le nombre de classés.",
    offer_seats_required: "Indique le nombre de places, de 1 à 8.",
    offer_seats_below_members: "Plus de personnes ont déjà une place.",
    offer_full: "Il n'y a plus de place.",
    offer_owner_member: "Tu proposes déjà ces places.",
    offer_already_member: "Cette personne a déjà une place de cette sorte pour cet événement.",
    time_invalid: "L'heure doit être de la forme 06:30.",
    merge_same_record: "Choisis deux éléments différents.",
    merge_formats_different_events: "Ces deux épreuves ne sont pas du même événement.",
    not_found: "Introuvable : il a peut-être été supprimé.",
    forbidden: "Tu n'as pas le droit de faire ça.",
    passkey_failed: "La clé d'accès n'a pas pu être vérifiée.",
    passkey_session_expired: "La demande a expiré. Recommence.",
    account_disabled: "Ce compte est désactivé. Contacte l'admin.",
    token_invalid: "Ce jeton n'est pas valide, ou il a été révoqué.",
    token_limit: "Tu as déjà 5 jetons : révoque-en un pour en créer un autre.",
    upload_invalid: "Cet envoi n'est pas valide, ou il a expiré.",
    push_endpoint_invalid: "Cet appareil ne peut pas être enregistré pour les notifications.",
    push_unavailable: "Les notifications ne sont pas disponibles pour l'instant.",
    weather_unavailable: "La météo n'a pas pu être chargée. Réessaie dans un moment.",
    // PocketBase's own validation codes.
    validation_required: "Ce champ est obligatoire.",
    validation_not_unique: "Cette valeur est déjà utilisée.",
    validation_invalid_email: "Cet email n'est pas valide.",
    validation_invalid_url: "Cette adresse web n'est pas valide.",
    validation_invalid_old_password: "Le mot de passe actuel est incorrect.",
    validation_min_text_constraint: "Cette valeur est trop courte.",
    validation_max_text_constraint: "Ce texte est trop long.",
    validation_values_mismatch: "Les deux valeurs sont différentes.",
    validation_file_size_limit: "La photo est trop lourde : 5 Mo maximum.",
    validation_invalid_mime_type: "Ce type d'image n'est pas accepté : JPEG, PNG ou WebP.",
  },
};

export type Messages = typeof fr;
