import { defineSettings, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

const browser = z.enum(["paseo", "system"]);
export type ArtifactBrowser = z.infer<typeof browser>;
export const defaultArtifactBrowser: ArtifactBrowser = "paseo";

export const browserSettings = defineSettings({
  id: "browser",
  scope: "host",
  version: 1,
  schema: z.object({ browser: browser.default(defaultArtifactBrowser) }),
});

export const browserChanges = defineSubscription({
  name: "ryugi.browser-changes",
  input: z.object({}),
  event: z.object({ browser }),
});
