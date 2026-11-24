import { defineAttachmentSource, defineRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";

// 1. 修正 RPC 名称：全部使用小写短横线风格 (kebab-case)
export const searchAttachmentsRpc = defineRpc({
  name: "ryugi.search-attachments",
  input: z.object({
    query: z.string(),
    projectDir: z.string().optional(),
  }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const ryugiAttachments = defineAttachmentSource({
  id: "ryugi-attachments",
  title: "Ryugi 标注与工件",
  icon: "FileCode2",
  pickerTitle: "选择要引用的 Ryugi 真实批注、规范段落或画板方案",
  searchPlaceholder: "输入关键字搜索批注、Block 或画板方案...",
  search: searchAttachmentsRpc,
});

// 2. 修正 RPC: get-real-data，支持单例模式与工件选择
export const getRealDataRpc = defineRpc({
  name: "ryugi.get-real-data",
  input: z.object({
    agentId: z.string().optional(),
    workspaceId: z.string().optional(),
    docArtifact: z.string().optional(),
    artboardArtifact: z.string().optional(),
    overrideProjectDir: z.string().optional(),
  }),
  output: z.object({
    serverUrl: z.string(),
    projectDir: z.string(),
    availableDocs: z.array(z.string()),
    availableArtboards: z.array(z.string()),
    currentDoc: z.object({
      artifact: z.string(),
      webUrl: z.string(),
      blocks: z.array(
        z.object({
          id: z.string(),
          tag: z.string(),
          text: z.string(),
        })
      ),
      comments: z.array(
        z.object({
          id: z.string(),
          blockId: z.string().optional(),
          author: z.string(),
          text: z.string(),
          at: z.string(),
        })
      ),
    }),
    currentArtboard: z.object({
      artifact: z.string(),
      webUrl: z.string(),
      boards: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          width: z.number(),
          height: z.number(),
          file: z.string(),
        })
      ),
    }),
  }),
});

// 3. 修正 RPC: add-real-comment
export const addRealCommentRpc = defineRpc({
  name: "ryugi.add-real-comment",
  input: z.object({
    artifact: z.string(),
    blockId: z.string(),
    text: z.string(),
    projectDir: z.string().optional(),
  }),
  output: z.object({
    success: z.boolean(),
    threadId: z.string().optional(),
    error: z.string().optional(),
  }),
});

// 4. 新增初始化会话单例工件 RPC: init-session-singleton
export const initSessionSingletonRpc = defineRpc({
  name: "ryugi.init-session-singleton",
  input: z.object({
    agentId: z.string(),
    workspaceId: z.string().optional(),
    title: z.string().optional(),
    projectDir: z.string().optional(),
  }),
  output: z.object({
    docArtifact: z.string(),
    artboardArtifact: z.string(),
    created: z.boolean(),
  }),
});
