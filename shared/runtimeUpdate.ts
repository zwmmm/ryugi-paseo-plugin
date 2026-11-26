import { defineRpc, defineSubscription, type SubscriptionEvent } from "@getpaseo/plugin";
import { z } from "zod";

export const startRuntimeUpdate = defineRpc({
  name: "ryugi.start-runtime-update",
  input: z.object({}),
  output: z.object({}),
});

export const runtimeUpdateStatus = defineSubscription({
  name: "ryugi.runtime-update-status",
  input: z.object({}),
  event: z.object({
    version: z.string(),
    phase: z.enum(["idle", "updating", "updated", "current", "failed"]),
  }),
});

export type RuntimeUpdateStatus = SubscriptionEvent<typeof runtimeUpdateStatus>;
