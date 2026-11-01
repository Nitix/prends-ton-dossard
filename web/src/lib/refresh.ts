import { ClientResponseError } from "pocketbase";

/**
 * Whether the server got the request and refused it (a 4xx): a validation, a
 * record that is not there any more, a rule. What the page shows may then be
 * out of date, which is often the reason for the refusal. A network failure
 * (status 0) or a server that fails (5xx) is not one: nothing is known of what
 * the server holds.
 */
export function isRefused(err: unknown): boolean {
  return err instanceof ClientResponseError && err.status >= 400 && err.status < 500;
}

/**
 * The `onSettled` of a mutation after which a list is asked for again, whether
 * the request worked or not. The mutation waits for the new list when it worked
 * or was refused, so that what the page does next (moving the focus, closing a
 * window, emptying a field) is done on the new data, and the refusal is shown
 * with the list that explains it. After any other failure it does not wait: the
 * list is asked for in the background and the failure is shown at once, since a
 * list that cannot be read is retried by the client for several seconds.
 */
export function refreshWhenSettled(refresh: () => Promise<unknown>) {
  return {
    onSettled: (_data: unknown, error: Error | null): Promise<unknown> | undefined => {
      const refreshed = refresh();
      if (error === null || isRefused(error)) return refreshed;
      void refreshed;
      return undefined;
    },
  };
}
