import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  searchAttachmentsRpc,
  getRealDataRpc,
  addRealCommentRpc,
  initSessionSingletonRpc,
} from "./shared/contracts.js";
import { realRyugiBridge } from "./server/realRyugiBridge.js";

export default function contribute(server: PluginServerContext) {
  // 1. 模式 B 附件检索 (小写短横线 RPC)
  server.handle(searchAttachmentsRpc, async ({ query, projectDir }) => {
    return realRyugiBridge.searchAttachments(query, projectDir);
  });

  // 2. 初始化 / 获取单例工件 (小写短横线 RPC)
  server.handle(initSessionSingletonRpc, async ({ agentId, title, projectDir }) => {
    const res = realRyugiBridge.ensureSessionSingleton(agentId, projectDir, title);
    return res;
  });

  // 3. 读取真实工件数据（支持单例或用户自由点选已有工件）
  server.handle(
    getRealDataRpc,
    async ({ agentId, docArtifact, artboardArtifact, overrideProjectDir }) => {
      const pDir = realRyugiBridge.getProjectDir(overrideProjectDir);
      const serverUrl = await realRyugiBridge.ensureServer(pDir);
      const artifacts = await realRyugiBridge.listArtifacts(pDir);

      const availableDocs = artifacts
        .filter((a) => a.artifact.startsWith("document/"))
        .map((a) => a.artifact);

      const availableArtboards = artifacts
        .filter((a) => a.artifact.startsWith("artboard/"))
        .map((a) => a.artifact);

      // 单例推导：如果传入 agentId 且用户未显式指定别的工件，则优先定位当前会话的单例工件
      let targetDoc = docArtifact;
      let targetArtboard = artboardArtifact;

      if (agentId) {
        const shortId = agentId.slice(-8);
        const sessionDoc = `document/session-${shortId}`;
        const sessionArt = `artboard/session-${shortId}`;

        if (!targetDoc) {
          targetDoc = availableDocs.includes(sessionDoc)
            ? sessionDoc
            : availableDocs[0] || sessionDoc;
        }
        if (!targetArtboard) {
          targetArtboard = availableArtboards.includes(sessionArt)
            ? sessionArt
            : availableArtboards[0] || sessionArt;
        }
      } else {
        targetDoc = targetDoc || availableDocs[0] || "document/master-prd";
        targetArtboard =
          targetArtboard || availableArtboards[0] || "artboard/prototype-demo";
      }

      // 读取当前选中文档
      const blocks = await realRyugiBridge.readDocumentBlocks(targetDoc, pDir);
      const rawComments = await realRyugiBridge.getComments(targetDoc, pDir);
      const comments = rawComments.map((c) => ({
        id: c.id,
        blockId: c.anchor?.blockId,
        author: c.messages[0]?.name || c.messages[0]?.author || "Reviewer",
        text: c.messages.map((m) => `${m.name || m.author}: ${m.text}`).join("\n"),
        at: c.messages[0]?.at || new Date().toISOString(),
      }));

      // 读取当前选中画板方案
      const boards = realRyugiBridge.readArtboardBoards(targetArtboard, pDir);

      return {
        serverUrl,
        projectDir: pDir,
        availableDocs,
        availableArtboards,
        currentDoc: {
          artifact: targetDoc,
          webUrl: `${serverUrl}/${targetDoc}`,
          blocks,
          comments,
        },
        currentArtboard: {
          artifact: targetArtboard,
          webUrl: `${serverUrl}/${targetArtboard}`,
          boards,
        },
      };
    }
  );

  // 4. 追加批注
  server.handle(addRealCommentRpc, async ({ artifact, blockId, text, projectDir }) => {
    try {
      const res = await realRyugiBridge.addComment(artifact, blockId, text, projectDir);
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
