import { defineRpc, defineSettings, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

export const remotePassword = z.string().max(256);

export const remoteAccessSettings = defineSettings({
  id: "remote-access",
  scope: "host",
  version: 1,
  schema: z.object({ password: remotePassword.default("") }),
});

export const remoteArtifactRpc = defineRpc({
  name: "ryugi.remote-artifact",
  input: z.object({ url: z.string() }),
  output: z.object({ url: z.string() }),
});

export const startTunnelRpc = defineRpc({
  name: "ryugi.start-tunnel",
  input: z.object({}),
  output: z.object({ url: z.string() }),
});

export const stopTunnelRpc = defineRpc({
  name: "ryugi.stop-tunnel",
  input: z.object({}),
  output: z.object({ stopped: z.boolean() }),
});

export const tunnelStatus = defineSubscription({
  name: "ryugi.tunnel-status",
  input: z.object({}),
  event: z.object({ active: z.boolean() }),
});
