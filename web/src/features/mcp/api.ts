import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";

import { pb } from "../../lib/pb";
import { useUserId } from "../auth/session";

// The personal tokens of the signed-in member, with which an AI assistant acts
// on the site as them (see server/mcpauth). The server keeps only a hash of a
// token: its answer to a new one is the only place where the token is, so it is
// never put in a cache of the queries.

const PATH = "/api/app/mcp-tokens";

/** A token, as the list tells it: never its secret. `lastUsedAt` is empty for a token that was never used. */
export type McpToken = { id: string; name: string; created: string; lastUsedAt: string };

/** The address of the MCP server, how many tokens an account may have, and the tokens, newest first. */
export type McpStatus = { url: string; max: number; tokens: McpToken[] };

/** A token that has just been made: the answer holds the secret. */
export type CreatedMcpToken = McpToken & { token: string; url: string };

/**
 * Where the list is kept: under the account, since it says what the member
 * has. The login page can be opened over a session, and the next account must
 * not find (or be shown) the tokens of the previous one.
 */
function useMcpKey() {
  return ["mcp-tokens", useUserId()] as const;
}

/**
 * The tokens of the member; null when the server has no MCP (it answers 404:
 * the demo has none).
 */
export function useMcpTokens(): UseQueryResult<McpStatus | null> {
  const key = useMcpKey();
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        return await pb.send<McpStatus>(PATH, { method: "GET" });
      } catch (err) {
        if (err instanceof ClientResponseError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

/**
 * Makes a token named `name`. The answer holds the token, so it is kept for no
 * time (`gcTime` 0): it is let go of when nothing shows it any more. The list
 * gets the new token without its secret, and a read of it that is on its way
 * (the window was focused again, say) is cancelled first: it was started before
 * the change and would bring the old list back.
 */
export function useCreateMcpToken(): UseMutationResult<CreatedMcpToken, Error, string> {
  const queryClient = useQueryClient();
  const key = useMcpKey();
  return useMutation({
    gcTime: 0,
    mutationFn: (name) => pb.send<CreatedMcpToken>(PATH, { method: "POST", body: { name } }),
    onSuccess: async ({ id, name, created }) => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<McpStatus | null>(key, (status) =>
        status
          ? { ...status, tokens: [{ id, name, created, lastUsedAt: "" }, ...status.tokens] }
          : status,
      );
    },
  });
}

/**
 * Revokes a token: the assistant that holds it is refused from its next
 * request. The list loses it. When the server says it is not there (it was
 * revoked from another tab), the list is read again: it was out of date.
 */
export function useRevokeMcpToken(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  const key = useMcpKey();
  return useMutation({
    mutationFn: async (id) => {
      await pb.send(`${PATH}/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    onSuccess: async (_none, id) => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<McpStatus | null>(key, (status) =>
        status ? { ...status, tokens: status.tokens.filter((token) => token.id !== id) } : status,
      );
    },
    onError: (err) => {
      if (err instanceof ClientResponseError && err.status === 404) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
