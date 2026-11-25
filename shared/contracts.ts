import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

export const sessionDataRpc = defineRpc({
  name: "ryugi.session-data",
  input: z.object({ agentId: z.string(), workspaceId: z.string() }),
  output: z.object({
    artifacts: z.array(z.object({ artifact: z.string(), url: z.string() })),
  }),
});

export const workspaceChanges = defineSubscription({
  name: "ryugi.workspace-changes",
  input: z.object({ workspaceId: z.string() }),
  event: z.object({ changed: z.literal(true) }),
});
