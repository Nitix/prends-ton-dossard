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
  },
  // The measures of a format, next to its name (see features/events/formatName.ts).
  format: {
    // The cut-off time, the duration already formatted: "max 10h".
    max: (duration: string) => `max ${duration}`,
    // The elevation gain, the height already formatted: "2 400 m D+".
    elevation: (height: string) => `${height} D+`,
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
    race_type_in_use: "Impossible de supprimer ce type : des épreuves l'utilisent encore.",
    date_invalid: "Cette date n'est pas valide.",
    end_before_start: "La date de fin est avant la date de début.",
    format_date_out_of_range:
      "La date de l'épreuve doit être comprise dans les dates de l'événement.",
    format_other_event: "Cette épreuve appartient à un autre événement.",
    format_measure_required: "Indique au moins une distance, une durée ou un temps max.",
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
