import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Avatar } from "../../components/Avatar";
import { DANGER, DANGER_TEXT, PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { Field, INPUT } from "../../components/Field";
import { SECTION } from "../../components/section";
import { SectionMarker } from "../../components/Slots";
import { useToast } from "../../components/Toast";
import type { Messages } from "../../i18n/fr";
import { useI18n } from "../../i18n/I18nProvider";
import type { CommentRecord } from "../../lib/types";
import { useRestoreFocus } from "../../lib/useRestoreFocus";
import { isNotFound } from "../participations/errors";
import { canDeleteComment, canEditComment, type Me } from "../participations/permissions";
import { describeError } from "../profile/forms";
import {
  isEdited,
  useComments,
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
  type CommentView,
} from "./api";
import { RelativeTime } from "./RelativeTime";

/**
 * The comments of an event, the oldest first, with a field to write one. The
 * text of a comment is plain text: React puts it on the page as text, and its
 * line breaks are kept by the style, so nothing a member types is ever read as
 * HTML.
 *
 * The author of a comment can change it, and the author or an admin can delete
 * it, after a confirmation. A deleted comment takes the focus away with its
 * button: it goes to the title of the section, which is not in the tab order
 * (it only receives the focus from here). `me` is null while the runner of the
 * user loads: the comments can be read, not written.
 *
 * A comment that somebody else has deleted in the meantime is gone from the
 * list when the member changes or deletes it (those requests ask for the list
 * again, refused or not), and the member is told so (`commentError`). The text
 * field goes with the comment, so a toast says it, and the title of the section
 * has the focus.
 */
export function CommentsSection({ eventId, me }: { eventId: string; me: Me | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const query = useComments(eventId);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // The comment the open confirmation is about.
  const [removing, setRemoving] = useState<string | null>(null);
  useRestoreFocus(removing !== null, () => heading.current);

  /**
   * The comment that was being edited is not there any more: its field goes
   * with it. The title of the section takes the focus, if the member has not
   * gone on to something else in the meantime.
   */
  function gone(form: HTMLFormElement | null) {
    toast.show(t.errors.not_found);
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if (lost || form?.contains(active)) heading.current?.focus();
  }

  // A refresh that fails keeps what the section already shows. While the
  // comments load, or when they could not, the section is there all the same,
  // with its title but no count.
  const comments = query.data;

  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-3 ${SECTION}`}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className="block-title section-title">
        <SectionMarker />
        {comments ? t.comments.title(comments.length) : t.comments.heading}
      </h2>
      {comments ? (
        comments.length === 0 ? (
          <p className="text-sm text-neutral-600">{t.comments.empty}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {comments.map((view) => (
              <CommentItem
                key={view.comment.id}
                view={view}
                eventId={eventId}
                me={me}
                onRemove={() => {
                  setRemoving(view.comment.id);
                }}
                onGone={gone}
              />
            ))}
          </ol>
        )
      ) : query.isError ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm font-medium text-red-700">
            {t.errors.generic}
          </p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className={`${SECONDARY} self-start`}
          >
            {t.common.retry}
          </button>
        </div>
      ) : (
        <output>{t.common.loading}</output>
      )}
      {me && comments && <NewComment eventId={eventId} />}
      <Dialog
        open={removing !== null}
        onClose={() => {
          setRemoving(null);
        }}
        title={t.comments.removeConfirm}
      >
        {removing !== null && (
          <DeleteForm
            eventId={eventId}
            commentId={removing}
            onClose={() => {
              setRemoving(null);
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

/**
 * The message for a refused change of a comment: one that is not there any
 * more (somebody else deleted it) says so, which the 404 of PocketBase has no
 * code for; any other refusal gets the message of its code.
 */
function commentError(t: Messages, err: unknown): string {
  return isNotFound(err) ? t.errors.not_found : describeError(t, err);
}

/** Ctrl+Enter, or Cmd+Enter on a Mac, in a text area: sends it, where Enter alone goes to the next line. */
function sendOnCtrlEnter(send: () => void) {
  return (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    }
  };
}

/**
 * A comment: who wrote it, when (and « modifié » when it was changed later), its
 * text, and the actions of the member on it. While it is being edited, its text
 * is a field, and the actions are « Enregistrer » and « Annuler ».
 */
function CommentItem({
  view,
  eventId,
  me,
  onRemove,
  onGone,
}: {
  view: CommentView;
  eventId: string;
  me: Me | null;
  onRemove: () => void;
  /** The comment turned out to be gone while its text was being changed: its form says which, to take the focus. */
  onGone: (form: HTMLFormElement | null) => void;
}) {
  const { t } = useI18n();
  const { comment, author } = view;
  const [editing, setEditing] = useState(false);
  // The line of the author (the name, and when) describes the actions: they have the same names on every comment.
  const authorId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // « Modifier » is gone while the text is a field: once it is back (saved or
  // cancelled), it gets the focus that the field and its buttons had.
  useEffect(() => {
    if (editing) {
      wasEditing.current = true;
      return;
    }
    if (!wasEditing.current) return;
    wasEditing.current = false;
    editButton.current?.focus();
  }, [editing]);

  const canEdit = !!me && canEditComment(author, me);
  const canDelete = !!me && canDeleteComment(author, me);

  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-neutral-50 p-3.5 ring-1 ring-neutral-100">
      <div className="flex items-center gap-3">
        <Avatar
          runner={author}
          thumb="96x96"
          className="avatar-soft size-11 shrink-0 text-sm font-bold"
        />
        <div id={authorId} className="min-w-0">
          <p className="font-medium break-words">{author.name}</p>
          <p className="text-sm text-neutral-600">
            <RelativeTime at={comment.created} />
            {isEdited(comment) && (
              <>
                {" · "}
                <span>{t.comments.edited}</span>
              </>
            )}
          </p>
        </div>
      </div>
      {editing ? (
        <EditForm
          comment={comment}
          eventId={eventId}
          onClose={() => {
            setEditing(false);
          }}
          onGone={onGone}
        />
      ) : (
        <>
          <p className="break-words whitespace-pre-wrap">{comment.body}</p>
          {(canEdit || canDelete) && (
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <button
                  ref={editButton}
                  type="button"
                  aria-describedby={authorId}
                  onClick={() => {
                    setEditing(true);
                  }}
                  className={SECONDARY}
                >
                  {t.comments.edit}
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  aria-describedby={authorId}
                  onClick={onRemove}
                  className={`${SECONDARY} ${DANGER_TEXT}`}
                >
                  {t.comments.remove}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}

/** The text of a comment as a field, with the text so far: it has the focus, at the end of the text. */
function EditForm({
  comment,
  eventId,
  onClose,
  onGone,
}: {
  comment: CommentRecord;
  eventId: string;
  onClose: () => void;
  onGone: (form: HTMLFormElement | null) => void;
}) {
  const { t } = useI18n();
  const update = useUpdateComment(eventId);
  const [body, setBody] = useState(comment.body);
  const [message, setMessage] = useState<string | null>(null);
  // Set on the spot: the state of the mutation is there after a render only, and two taps can come before it.
  const sending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  async function save() {
    const text = body.trim();
    if (sending.current) return;
    // A comment cannot be emptied: say so, instead of doing nothing.
    if (text === "") {
      setMessage(t.errors.validation_required);
      return;
    }
    // Nothing changed: no request, which would only make the comment « modifié ».
    if (text === comment.body) {
      onClose();
      return;
    }
    sending.current = true;
    setMessage(null);
    try {
      await update.mutateAsync({ id: comment.id, body: text });
      onClose();
    } catch (err) {
      // The list has been asked for again: the comment, and this form with it, may be gone already.
      if (isNotFound(err)) onGone(form.current);
      else setMessage(commentError(t, err));
    } finally {
      sending.current = false;
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-2">
      <Field label={t.comments.editLabel} error={message}>
        {(control) => (
          <textarea
            {...control}
            ref={field}
            rows={3}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
            onKeyDown={sendOnCtrlEnter(() => void save())}
            className={`${INPUT} py-2`}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          aria-disabled={update.isPending || undefined}
          className={`${PRIMARY} ${update.isPending ? "opacity-60" : ""}`}
        >
          {t.comments.save}
        </button>
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.comments.cancel}
        </button>
      </div>
    </form>
  );
}

/**
 * The field that writes a comment, and « Envoyer ». The button stays enabled
 * while the comment is on its way (it only says it is busy), so that it keeps
 * the focus; a second send is ignored. Once sent, the field is empty.
 */
function NewComment({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const create = useCreateComment(eventId);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // Set on the spot: the state of the mutation is there after a render only, and two taps can come before it.
  const sending = useRef(false);

  async function send() {
    const text = body.trim();
    if (text === "" || sending.current) return;
    sending.current = true;
    setMessage(null);
    try {
      await create.mutateAsync(text);
      // Something typed while it was on its way is not lost.
      setBody((current) => (current === body ? "" : current));
    } catch (err) {
      setMessage(describeError(t, err));
    } finally {
      sending.current = false;
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Field label={t.comments.newLabel} hint={t.comments.sendHint} error={message}>
        {(control) => (
          <textarea
            {...control}
            rows={3}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
            onKeyDown={sendOnCtrlEnter(() => void send())}
            className={`${INPUT} py-2`}
          />
        )}
      </Field>
      <button
        type="submit"
        aria-disabled={create.isPending || undefined}
        className={`${PRIMARY} self-start ${create.isPending ? "opacity-60" : ""}`}
      >
        {t.comments.send}
      </button>
    </form>
  );
}

/** The confirmation of the deletion of a comment: it is deleted when the member says so, and the window closes. */
function DeleteForm({
  eventId,
  commentId,
  onClose,
}: {
  eventId: string;
  commentId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const remove = useDeleteComment(eventId);
  const [message, setMessage] = useState<string | null>(null);
  // Set on the spot: the state of the mutation is there after a render only, and two taps can come before it.
  const sending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setMessage(null);
    try {
      await remove.mutateAsync(commentId);
    } catch (err) {
      sending.current = false;
      setMessage(commentError(t, err));
      return;
    }
    onClose();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {message !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.comments.cancel}
        </button>
        <button
          type="submit"
          aria-disabled={remove.isPending || undefined}
          className={`${DANGER} ${remove.isPending ? "opacity-60" : ""}`}
        >
          {t.comments.remove}
        </button>
      </div>
    </form>
  );
}
