import { defineAttachmentSource, defineRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";

// 1. 模式 B 核心：Composer 附件源检索 RPC
export const searchAttachmentsRpc = defineRpc({
  name: "ryugi.searchAttachments",
  input: z.object({
    query: z.string(),
  }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const ryugiAttachments = defineAttachmentSource({
  id: "ryugi-attachments",
  title: "Ryugi 标注与工件",
  icon: "FileCode2",
  pickerTitle: "选择要引用的 Ryugi 真实批注、规范段落或画板方案",
  searchPlaceholder: "输入关键字搜索真实批注、Block 或画板方案...",
  search: searchAttachmentsRpc,
});

// 2. 获取真实工件列表与当前展示数据 RPC
export const getRealDataRpc = defineRpc({
  name: "ryugi.getRealData",
  input: z.object({
    docArtifact: z.string().optional(),
    artboardArtifact: z.string().optional(),
  }),
  output: z.object({
    serverUrl: z.string(),
    artifacts: z.array(
      z.object({
        artifact: z.string(),
        write: z.string(),
        content: z.string(),
        bytes: z.number().optional(),
      })
    ),
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

// 3. 向 Ryugi 真实引擎追加批注 RPC
export const addRealCommentRpc = defineRpc({
  name: "ryugi.addRealComment",
  input: z.object({
    artifact: z.string(),
    blockId: z.string(),
    text: z.string(),
  }),
  output: z.object({
    success: z.boolean(),
    threadId: z.string().optional(),
    error: z.string().optional(),
  }),
});
