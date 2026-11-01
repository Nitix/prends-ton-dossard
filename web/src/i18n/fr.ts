// The French dictionary is the reference. en.ts is typed against it
// (`satisfies Messages`), so a missing or extra key fails the type check.
// A text with a variable is a function.
export const fr = {
  common: {
    appName: "Courses",
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
  },
  // The profile page: the name, the email and the password of the account,
  // then the passkeys (see `passkeys`).
  profile: {
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
  // The labels of the participation statuses.
  status: {
    interested: "Intéressé",
    registered: "Inscrit",
    finished: "Terminé",
    dnf: "Abandon",
    dns: "Non partant",
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
    // The page of an event (see features/events/EventPage.tsx).
    register: "S'inscrire sur le site officiel",
    nobody: "Personne pour l'instant.",
    // Under a participant on the page of an event: who added them, and that they have not agreed yet.
    addedByUnconfirmed: (name: string) => `ajouté par ${name} · non confirmé`,
    deleteTitle: "Supprimer l'événement ?",
    deleteWarning: (name: string) =>
      `« ${name} » sera supprimé, avec ses épreuves et leurs participations.`,
    // Followed by the names of the participants, already joined: "Alice, Bob et Sam".
    deleteParticipants: "Participants concernés :",
    deleted: "Événement supprimé.",
  },
  // What a member does with the participations of an event (see features/participations).
  participation: {
    // The button of the page, and the title of its dialog.
    join: "J'y vais",
    joinTitle: "J'y vais",
    alreadyIn: "Tu es déjà sur cet événement : tu peux changer d'épreuve ou de statut.",
    addSomeone: "Ajouter quelqu'un",
    addSomeoneTitle: "Ajouter quelqu'un",
    addSubmit: "Ajouter",
    runner: "Coureur",
    chooseRunner: "Choisis un coureur",
    format: "Épreuve",
    status: "Statut",
    everyoneThere: "Tout le monde est déjà sur cette épreuve.",
    alreadyThere: "Cette personne est déjà sur cette épreuve.",
    // The accessible name of the menu button of a participant.
    actionsFor: (name: string) => `Actions pour ${name}`,
    removeTitle: "Retirer de l'épreuve ?",
    removeWarning: (name: string, format: string) => `${name} ne sera plus sur « ${format} ».`,
  },
  // The measures of a format, next to its name (see features/events/formatName.ts).
  format: {
    // The cut-off time, the duration already formatted: "max 10h".
    max: (duration: string) => `max ${duration}`,
    // The elevation gain, the height already formatted: "2 400 m D+".
    elevation: (height: string) => `${height} D+`,
  },
  // The form that creates or edits an event and its formats (see features/events/EventForm.tsx).
  form: {
    createTitle: "Créer un événement",
    editTitle: "Modifier l'événement",
    name: "Nom de l'événement",
    location: "Lieu",
    locationHint: "Une ville ou un lieu.",
    startDate: "Date de début",
    endDate: "Date de fin",
    endDateHint: "Seulement si l'événement dure plusieurs jours.",
    registrationUrl: "Lien pour s'inscrire",
    registrationUrlHint: "Facultatif : l'adresse de la page d'inscription.",
    notes: "Notes",
    formatsTitle: "Épreuves",
    // The title of the group of fields of a format, from 1.
    formatTitle: (n: number) => `Épreuve ${n}`,
    formatName: "Nom de l'épreuve",
    formatNameHint:
      "Facultatif : sinon il est fait du type et de la distance, « Trail 42 km » par exemple.",
    raceType: "Type de course",
    chooseRaceType: "Choisis un type",
    measuresHint: "Au moins une de ces trois mesures est obligatoire.",
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
    upcomingTitle: "Mes prochaines courses",
    upcomingEmpty: "Aucune course à venir. Ouvre un événement et touche « J'y vais ».",
    groupTitle: "Bientôt dans le groupe",
    groupEmpty: "Personne n'est encore inscrit à un événement à venir.",
    // The banner that suggests a passkey (the text under it is `passkeys.intro`).
    passkeyTitle: "Ajoute une clé d'accès",
    passkeyLink: "Ajouter dans mon profil",
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
      invite: "Invitation sur Courses",
      reset: "Nouveau mot de passe sur Courses",
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
    format_date_out_of_range:
      "La date de l'épreuve doit être comprise dans les dates de l'événement.",
    format_other_event: "Cette épreuve appartient à un autre événement.",
    format_measure_required: "Indique au moins une distance, une durée ou un temps max.",
    format_required: "Il faut choisir une épreuve.",
    merge_same_record: "Choisis deux éléments différents.",
    merge_formats_different_events: "Ces deux épreuves ne sont pas du même événement.",
    not_found: "Introuvable : il a peut-être été supprimé.",
    forbidden: "Tu n'as pas le droit de faire ça.",
    passkey_failed: "La clé d'accès n'a pas pu être vérifiée.",
    passkey_session_expired: "La demande a expiré. Recommence.",
    account_disabled: "Ce compte est désactivé. Contacte l'admin.",
    // PocketBase's own validation codes.
    validation_required: "Ce champ est obligatoire.",
    validation_not_unique: "Cette valeur est déjà utilisée.",
    validation_invalid_email: "Cet email n'est pas valide.",
    validation_invalid_old_password: "Le mot de passe actuel est incorrect.",
    validation_min_text_constraint: "Cette valeur est trop courte.",
    validation_values_mismatch: "Les deux valeurs sont différentes.",
  },
};

export type Messages = typeof fr;
