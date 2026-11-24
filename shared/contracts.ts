import { defineAttachmentSource, defineRpc, defineSubscription, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";

export const searchAttachmentsRpc = defineRpc({
  name: "ryugi.search-attachments",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const ryugiAttachments = defineAttachmentSource({
  id: "ryugi-attachments",
  title: "Ryugi 评论",
  icon: "MessageSquare",
  pickerTitle: "选择 Ryugi 评论",
  searchPlaceholder: "搜索工作区、工件或评论...",
  search: searchAttachmentsRpc,
});

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
