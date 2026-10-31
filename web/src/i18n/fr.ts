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
  },
  // The labels of the participation statuses.
  status: {
    interested: "Intéressé",
    registered: "Inscrit",
    finished: "Terminé",
    dnf: "Abandon",
    dns: "Non partant",
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
  },
};

export type Messages = typeof fr;
