import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";

import { pb } from "../../lib/pb";
import { useUserId } from "../auth/session";

// The devices of the signed-in member that receive notifications (see server/push).

const PATH = "/api/app/push";

export type PushDevice = {
  id: string;
  label: string;
  /** PocketBase date-time. */
  created: string;
  /** PocketBase date-time, empty before the first delivery. */
  lastSuccessAt: string;
};

export type PushInfo = {
  /** False when the keys of the server are unreadable. */
  available: boolean;
  publicKey?: string;
  devices: PushDevice[];
};

/** What the server has for this member; null when it has no notifications (404: the demo). */
export async function fetchPush(): Promise<PushInfo | null> {
  try {
    return await pb.send<PushInfo>(PATH, { method: "GET" });
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return null;
    throw err;
  }
}

/** The key of the list: under the account, as for the reminders. */
export function pushKey(userId: string) {
  return ["push", userId] as const;
}

export function usePush(): UseQueryResult<PushInfo | null> {
  return useQuery({ queryKey: pushKey(useUserId()), queryFn: fetchPush });
}

/** Registers a subscription of the browser (idempotent: the same address is updated) and gives the id of the device. */
export async function postSubscription(
  subscription: PushSubscription,
  lang: string,
  label: string,
): Promise<string> {
  const { endpoint, keys } = subscription.toJSON();
  const answer = await pb.send<{ id: string }>(`${PATH}/subscriptions`, {
    method: "POST",
    body: { endpoint, keys, lang, label },
  });
  return answer.id;
}

/** This device lets go of its subscription. */
export async function deleteSubscription(endpoint: string): Promise<void> {
  await pb.send(`${PATH}/subscriptions`, { method: "DELETE", body: { endpoint } });
}

/** Removes one of the member's devices. */
export async function deleteDevice(id: string): Promise<void> {
  await pb.send(`${PATH}/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Sends the test to every device of the member. */
export function sendTest(): Promise<{ sent: number; failed: number }> {
  return pb.send(`${PATH}/test`, { method: "POST" });
}
