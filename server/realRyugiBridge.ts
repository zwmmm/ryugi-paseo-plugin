import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFileAsync = promisify(execFile);
const RYUGI_CLI = path.resolve(__dirname, "../../ryugi-repo/skills/artifacts/app/ryugi.cjs");
const DEFAULT_PROJECT_DIR = path.resolve(__dirname, "../../ryugi-repo");

export interface RealArtifactItem {
  artifact: string;
  write: string;
  content: string;
  bytes?: number;
  modifiedAt?: string;
}

export interface RealCommentItem {
  id: string;
  anchor: { blockId?: string; quote?: string; boardId?: string };
  status: string;
  messages: Array<{
    id: string;
    author: "human" | "agent";
    name?: string;
    text: string;
    at: string;
  }>;
}

export class RealRyugiBridge {
  private projectDir: string;
  private serverUrl: string | null = null;

  constructor(projectDir: string = DEFAULT_PROJECT_DIR) {
    this.projectDir = projectDir;
  }

  /**
   * 确保 Ryugi 本地 server 启动，并获取其访问基础地址
   */
  async ensureServer(artifact: string = "document/comment-demo"): Promise<string> {
    if (this.serverUrl) return this.serverUrl;
    try {
      const { stdout } = await execFileAsync("node", [
        RYUGI_CLI,
        "start",
        "--background",
        "--no-open",
        "--project-dir",
        this.projectDir,
        "--artifact",
        artifact,
        "--json",
      ]);
      const res = JSON.parse(stdout);
      if (res?.data?.url) {
        this.serverUrl = res.data.url;
        return this.serverUrl!;
      }
    } catch (e) {
      console.error("[RealRyugiBridge] Failed to start server:", e);
    }
    return "http://localhost:27319";
  }

  /**
   * 通过原生 ryugi get 获取项目下所有工件列表
   */
  async listArtifacts(): Promise<RealArtifactItem[]> {
    try {
      const { stdout } = await execFileAsync("node", [
        RYUGI_CLI,
        "get",
        "--project-dir",
        this.projectDir,
        "--json",
      ]);
      const res = JSON.parse(stdout);
      return res?.data?.items || [];
    } catch (e) {
      console.error("[RealRyugiBridge] listArtifacts error:", e);
      return [];
    }
  }

  /**
   * 获取某个工件上的所有批注评论
   */
  async getComments(artifact: string): Promise<RealCommentItem[]> {
    try {
      const { stdout } = await execFileAsync("node", [
        RYUGI_CLI,
        "comment",
        "list",
        "--artifact",
        artifact,
        "--sections",
        "all",
        "--detail",
        "--project-dir",
        this.projectDir,
        "--json",
      ]);
      const res = JSON.parse(stdout);
      return res?.data?.sections?.threads?.items || [];
    } catch {
      return [];
    }
  }

  /**
   * 向真实 Ryugi 提交一条批注评论
   */
  async addComment(artifact: string, blockId: string, text: string) {
    const { stdout } = await execFileAsync("node", [
      RYUGI_CLI,
      "comment",
      "add",
      "--artifact",
      artifact,
      "--block",
      blockId,
      "--text",
      text,
      "--project-dir",
      this.projectDir,
      "--json",
    ]);
    return JSON.parse(stdout);
  }

  /**
   * 读取文档源码 (XML) 并解析出段落 blocks
   */
  async readDocumentBlocks(artifact: string) {
    const relativePath = artifact.replace("document/", "");
    const docPath = path.join(this.projectDir, ".ryugi/artifacts/document", relativePath, "doc.xml");
    if (!fs.existsSync(docPath)) return [];
    const content = fs.readFileSync(docPath, "utf-8");

    // 解析包含 id 的段落/标题/代码块
    const regex = /<(h[1-6]|p|codeblock|table|alert)[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
    const blocks: Array<{ id: string; tag: string; text: string }> = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      const tag = match[1];
      const id = match[2];
      const innerText = match[3].replace(/<[^>]+>/g, "").trim();
      blocks.push({ id, tag, text: innerText });
    }
    return blocks;
  }

  /**
   * 搜索可供 Composer Attachment 引用的真实批注和图元（模式 B）
   */
  async searchAttachments(query: string) {
    const q = query.trim().toLowerCase();
    const artifacts = await this.listArtifacts();
    const items: Array<{
      id: string;
      identifier: string;
      title: string;
      subtitle?: string;
      url: string;
      text: string;
      resourceType: string;
    }> = [];

    // 1. 检索所有真实工件的批注
    for (const art of artifacts) {
      const comments = await this.getComments(art.artifact);
      for (const c of comments) {
        const firstMsg = c.messages[0];
        const msgText = firstMsg?.text || "";
        const author = firstMsg?.name || firstMsg?.author || "Reviewer";
        if (!q || msgText.toLowerCase().includes(q) || art.artifact.toLowerCase().includes(q)) {
          items.push({
            id: `ryugi-comment-${c.id}`,
            identifier: `#批注-${c.id.slice(-4)}`,
            title: `[Ryugi 批注] ${art.artifact}: "${msgText.slice(0, 30)}${msgText.length > 30 ? "..." : ""}"`,
            subtitle: `由 ${author} 提出 · 归属: ${art.artifact} (锚点: ${c.anchor.blockId || "通用"})`,
            url: `http://localhost:27319/${art.artifact}#${c.id}`,
            text: `【Ryugi 真实批注引用】\n- 工件: ${art.artifact}\n- 锚点块: ${c.anchor.blockId || "页面"}\n- 提出人: ${author}\n- 批注内容: ${msgText}\n`,
            resourceType: "ryugi-comment",
          });
        }
      }

      // 2. 检索文档里的关键规范块
      if (art.artifact.startsWith("document/")) {
        const blocks = await this.readDocumentBlocks(art.artifact);
        for (const b of blocks) {
          if (!q || b.text.toLowerCase().includes(q) || b.id.toLowerCase().includes(q)) {
            items.push({
              id: `ryugi-block-${art.artifact}-${b.id}`,
              identifier: `#规范-${b.id}`,
              title: `[Ryugi 规范] ${art.artifact} #${b.id}: "${b.text.slice(0, 30)}..."`,
              subtitle: `类型: <${b.tag}> · 来源: ${art.artifact}`,
              url: `http://localhost:27319/${art.artifact}#${b.id}`,
              text: `【Ryugi 规范段落引用】\n- 文档: ${art.artifact}\n- 目标锚点: #${b.id} (<${b.tag}>)\n- 规范内容:\n> ${b.text}\n`,
              resourceType: "ryugi-doc-block",
            });
          }
        }
      }

      // 3. 检索画板里的方案
      if (art.artifact.startsWith("artboard/")) {
        const canvasPath = path.join(this.projectDir, ".ryugi/artifacts", art.artifact, "canvas.json");
        if (fs.existsSync(canvasPath)) {
          try {
            const canvas = JSON.parse(fs.readFileSync(canvasPath, "utf-8"));
            for (const [boardId, board] of Object.entries<any>(canvas.boards || {})) {
              if (!q || boardId.toLowerCase().includes(q) || (board.name && board.name.toLowerCase().includes(q))) {
                items.push({
                  id: `ryugi-board-${art.artifact}-${boardId}`,
                  identifier: `#方案-${boardId}`,
                  title: `[Ryugi 画板方案] ${board.name || boardId}`,
                  subtitle: `画板: ${art.artifact} (尺寸: ${board.width}x${board.height})`,
                  url: `http://localhost:27319/${art.artifact}#${boardId}`,
                  text: `【Ryugi 画板方案引用】\n- 画板工件: ${art.artifact}\n- 方案标识: ${boardId}\n- 方案名称: ${board.name}\n- 尺寸坐标: (${board.x}, ${board.y}) ${board.width}x${board.height}\n- 对应渲染文件: ${board.file}\n`,
                  resourceType: "ryugi-artboard-element",
                });
              }
            }
          } catch {}
        }
      }
    }

    return { items };
  }
}

export const realRyugiBridge = new RealRyugiBridge();
