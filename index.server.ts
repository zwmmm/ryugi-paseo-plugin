import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  searchAttachmentsRpc,
  getRealDataRpc,
  addRealCommentRpc,
} from "./shared/contracts.js";
import { realRyugiBridge } from "./server/realRyugiBridge.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function contribute(server: PluginServerContext) {
  // 1. 处理 Pattern B 的 Attachment 搜索（真正调用 Ryugi CLI 与本地工件存储）
  server.handle(searchAttachmentsRpc, async ({ query }) => {
    return realRyugiBridge.searchAttachments(query);
  });

  // 2. 读取当前真实工件、文档解析块、画板以及批注
  server.handle(getRealDataRpc, async ({ docArtifact, artboardArtifact }) => {
    const docArt = docArtifact || "document/comment-demo";
    const artArt = artboardArtifact || "artboard/layout-demo";

    const serverUrl = await realRyugiBridge.ensureServer(docArt);
    const artifacts = await realRyugiBridge.listArtifacts();

    // 文档与批注
    const blocks = await realRyugiBridge.readDocumentBlocks(docArt);
    const rawComments = await realRyugiBridge.getComments(docArt);
    const comments = rawComments.map((c) => ({
      id: c.id,
      blockId: c.anchor?.blockId,
      author: c.messages[0]?.name || c.messages[0]?.author || "评审员",
      text: c.messages.map((m) => `${m.name || m.author}: ${m.text}`).join("\n"),
      at: c.messages[0]?.at || new Date().toISOString(),
    }));

    // 画板方案
    const boards: Array<{ id: string; name: string; width: number; height: number; file: string }> = [];
    const canvasPath = path.resolve(
      __dirname,
      "../../ryugi-repo/.ryugi/artifacts",
      artArt,
      "canvas.json"
    );
    if (fs.existsSync(canvasPath)) {
      try {
        const canvas = JSON.parse(fs.readFileSync(canvasPath, "utf-8"));
        for (const [id, val] of Object.entries<any>(canvas.boards || {})) {
          boards.push({
            id,
            name: val.name || id,
            width: val.width || 800,
            height: val.height || 500,
            file: val.file || "",
          });
        }
      } catch {}
    }

    return {
      serverUrl,
      artifacts,
      currentDoc: {
        artifact: docArt,
        webUrl: `${serverUrl}/${docArt}`,
        blocks,
        comments,
      },
      currentArtboard: {
        artifact: artArt,
        webUrl: `${serverUrl}/${artArt}`,
        boards,
      },
    };
  });

  // 3. 提交真实批注（调用 ryugi comment add 写入本地 .ryugi/ 存储）
  server.handle(addRealCommentRpc, async ({ artifact, blockId, text }) => {
    try {
      const res = await realRyugiBridge.addComment(artifact, blockId, text);
      return {
        success: res.outcome === "success",
        threadId: res.data?.threadId,
      };
    } catch (err: any) {
      return {
        success: false,
        error: String(err?.message || err),
      };
    }
  });

  return () => {};
}
