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
    async ({ agentId, workspaceId, docArtifact, artboardArtifact, overrideProjectDir }, { paseo }) => {
      let resolvedDir = overrideProjectDir;
      if (!resolvedDir && workspaceId) {
        try {
          const ws = await paseo.workspaces.ref(workspaceId).current();
          if (ws?.workspaceDirectory) {
            resolvedDir = ws.workspaceDirectory;
          } else if (ws?.projectRootPath) {
            resolvedDir = ws.projectRootPath;
          }
        } catch {}
      }

      const pDir = realRyugiBridge.getProjectDir(resolvedDir);
      const serverUrl = await realRyugiBridge.ensureServer(pDir);
      const embedServerUrl = await realRyugiBridge.ensureEmbedProxy();

      // 如果有 agentId，自动确保当前会话的单例工件已存在
      if (agentId) {
        realRyugiBridge.ensureSessionSingleton(agentId, pDir);
      }

      const artifacts = await realRyugiBridge.listArtifacts(pDir);

      const availableDocs = artifacts
        .filter((a) => a.artifact.startsWith("document/"))
        .map((a) => a.artifact);

      const availableArtboards = artifacts
        .filter((a) => a.artifact.startsWith("artboard/"))
        .map((a) => a.artifact);

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
        targetDoc = targetDoc || availableDocs[0] || "document/comment-demo";
        targetArtboard =
          targetArtboard || availableArtboards[0] || "artboard/layout-demo";
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
        embedServerUrl,
        projectDir: pDir,
        availableDocs,
        availableArtboards,
        currentDoc: {
          artifact: targetDoc,
          webUrl: `${serverUrl}/${targetDoc}`,
          embedUrl: `${embedServerUrl}/${targetDoc}`,
          blocks,
          comments,
        },
        currentArtboard: {
          artifact: targetArtboard,
          webUrl: `${serverUrl}/${targetArtboard}`,
          embedUrl: `${embedServerUrl}/${targetArtboard}`,
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
