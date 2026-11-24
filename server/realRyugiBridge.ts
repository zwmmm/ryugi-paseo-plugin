import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

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

/**
 * 探测可用的 ryugi CLI 路径：
 * 1. 优先使用环境变量 RYUGI_CLI_PATH
 * 2. 检查系统 PATH 中的 ryugi
 * 3. 兜底回退至本地已知的 ryugi.cjs 相对路径
 */
function resolveRyugiCli(): string {
  if (process.env.RYUGI_CLI_PATH && fs.existsSync(process.env.RYUGI_CLI_PATH)) {
    return process.env.RYUGI_CLI_PATH;
  }
  try {
    const whichRes = execSync("which ryugi", { encoding: "utf-8" }).trim();
    if (whichRes && fs.existsSync(whichRes)) {
      return whichRes;
    }
  } catch {}
  
  // 兜底：尝试从 cwd 或向上查找
  const fallbackPaths = [
    path.resolve(process.cwd(), "ryugi-repo/skills/artifacts/app/ryugi.cjs"),
    path.resolve(process.cwd(), "../ryugi-repo/skills/artifacts/app/ryugi.cjs"),
  ];
  for (const p of fallbackPaths) {
    if (fs.existsSync(p)) return p;
  }
  return "ryugi";
}

/**
 * 探测默认项目目录：
 * 优先使用 RYUGI_PROJECT_DIR，次之使用 process.cwd()
 */
function resolveDefaultProjectDir(): string {
  if (process.env.RYUGI_PROJECT_DIR && fs.existsSync(process.env.RYUGI_PROJECT_DIR)) {
    return process.env.RYUGI_PROJECT_DIR;
  }
  return process.cwd();
}

export class RealRyugiBridge {
  private customCliPath: string | null = null;
  private customProjectDir: string | null = null;
  private serverUrl: string | null = null;

  constructor(cliPath?: string, projectDir?: string) {
    if (cliPath) this.customCliPath = cliPath;
    if (projectDir) this.customProjectDir = projectDir;
  }

  public getCliPath(): string {
    return this.customCliPath || resolveRyugiCli();
  }

  public getProjectDir(override?: string): string {
    if (override && fs.existsSync(override)) return override;
    return this.customProjectDir || resolveDefaultProjectDir();
  }

  public setProjectDir(dir: string) {
    this.customProjectDir = dir;
  }

  /**
   * 确保 Ryugi 本地 server 启动，并获取其访问基础地址
   */
  async ensureServer(projectDir?: string, artifact?: string): Promise<string> {
    if (this.serverUrl) return this.serverUrl;
    const pDir = this.getProjectDir(projectDir);
    const cli = this.getCliPath();
    const art = artifact || "document/master-prd";

    try {
      const args = [
        "start",
        "--background",
        "--no-open",
        "--project-dir",
        pDir,
        "--artifact",
        art,
        "--json",
      ];

      // 如果 cli 是 .js/.cjs 脚本则用 node 启动，否则直接运行二进制
      let stdout: string;
      if (cli.endsWith(".cjs") || cli.endsWith(".js")) {
        const res = await execFileAsync("node", [cli, ...args]);
        stdout = res.stdout;
      } else {
        const res = await execFileAsync(cli, args);
        stdout = res.stdout;
      }

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
  async listArtifacts(projectDir?: string): Promise<RealArtifactItem[]> {
    const pDir = this.getProjectDir(projectDir);
    const cli = this.getCliPath();
    try {
      const args = ["get", "--project-dir", pDir, "--json"];
      let stdout: string;
      if (cli.endsWith(".cjs") || cli.endsWith(".js")) {
        const res = await execFileAsync("node", [cli, ...args]);
        stdout = res.stdout;
      } else {
        const res = await execFileAsync(cli, args);
        stdout = res.stdout;
      }
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
  async getComments(artifact: string, projectDir?: string): Promise<RealCommentItem[]> {
    const pDir = this.getProjectDir(projectDir);
    const cli = this.getCliPath();
    try {
      const args = [
        "comment",
        "list",
        "--artifact",
        artifact,
        "--sections",
        "all",
        "--detail",
        "--project-dir",
        pDir,
        "--json",
      ];
      let stdout: string;
      if (cli.endsWith(".cjs") || cli.endsWith(".js")) {
        const res = await execFileAsync("node", [cli, ...args]);
        stdout = res.stdout;
      } else {
        const res = await execFileAsync(cli, args);
        stdout = res.stdout;
      }
      const res = JSON.parse(stdout);
      return res?.data?.sections?.threads?.items || [];
    } catch {
      return [];
    }
  }

  /**
   * 向真实 Ryugi 提交一条批注评论
   */
  async addComment(artifact: string, blockId: string, text: string, projectDir?: string) {
    const pDir = this.getProjectDir(projectDir);
    const cli = this.getCliPath();
    const args = [
      "comment",
      "add",
      "--artifact",
      artifact,
      "--block",
      blockId,
      "--text",
      text,
      "--project-dir",
      pDir,
      "--json",
    ];
    let stdout: string;
    if (cli.endsWith(".cjs") || cli.endsWith(".js")) {
      const res = await execFileAsync("node", [cli, ...args]);
      stdout = res.stdout;
    } else {
      const res = await execFileAsync(cli, args);
      stdout = res.stdout;
    }
    return JSON.parse(stdout);
  }

  /**
   * 读取文档源码 (XML) 并解析出段落 blocks
   */
  async readDocumentBlocks(artifact: string, projectDir?: string) {
    const pDir = this.getProjectDir(projectDir);
    const relativePath = artifact.replace("document/", "");
    const docPath = path.join(pDir, ".ryugi/artifacts/document", relativePath, "doc.xml");
    if (!fs.existsSync(docPath)) return [];
    const content = fs.readFileSync(docPath, "utf-8");

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
   * 读取画板中的方案列表
   */
  readArtboardBoards(artifact: string, projectDir?: string) {
    const pDir = this.getProjectDir(projectDir);
    const canvasPath = path.join(pDir, ".ryugi/artifacts", artifact, "canvas.json");
    const boards: Array<{ id: string; name: string; width: number; height: number; file: string }> = [];
    if (!fs.existsSync(canvasPath)) return boards;

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
    return boards;
  }

  /**
   * 为单例会话初始化/确保存在唯一的 Document 和 Artboard
   */
  ensureSessionSingleton(agentId: string, projectDir?: string, title?: string) {
    const pDir = this.getProjectDir(projectDir);
    const shortId = agentId.slice(-8);
    const docArtifact = `document/session-${shortId}`;
    const artboardArtifact = `artboard/session-${shortId}`;

    const docDir = path.join(pDir, ".ryugi/artifacts", docArtifact);
    const artDir = path.join(pDir, ".ryugi/artifacts", artboardArtifact, "boards");

    let created = false;

    // 1. 初始化会话专属 Document
    if (!fs.existsSync(path.join(docDir, "doc.xml"))) {
      fs.mkdirSync(docDir, { recursive: true });
      const docXml = `<doc>
  <h1 id="title">${title || `Requirement PRD - Session ${shortId}`}</h1>
  <p id="overview">Single source of truth for this session. All modifications will update in place.</p>
  <h2 id="sec-1">1. Functional Specifications</h2>
  <p id="p-1">Define requirements and architecture components here.</p>
</doc>
`;
      fs.writeFileSync(path.join(docDir, "doc.xml"), docXml);
      created = true;
    }

    // 2. 初始化会话专属 Artboard
    if (!fs.existsSync(path.join(pDir, ".ryugi/artifacts", artboardArtifact, "canvas.json"))) {
      fs.mkdirSync(artDir, { recursive: true });
      const canvasJson = {
        boards: {
          "primary-layout": {
            name: "Primary Prototype Variant",
            file: "boards/primary-layout.html",
            x: 0,
            y: 0,
            width: 800,
            height: 500,
          },
        },
      };
      fs.writeFileSync(
        path.join(pDir, ".ryugi/artifacts", artboardArtifact, "canvas.json"),
        JSON.stringify(canvasJson, null, 2) + "\n"
      );

      const htmlContent = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Session ${shortId} Artboard</title>
  <style>
    body { font-family: -apple-system, sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #f8fafc; }
    .box { border: 2px dashed #38bdf8; border-radius: 8px; padding: 24px; text-align: center; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Session ${shortId} - Living Prototype Board</h2>
    <p style="color: #94a3b8;">Add visual components or layout candidates to this board for this requirement.</p>
  </div>
</body>
</html>
`;
      fs.writeFileSync(path.join(artDir, "primary-layout.html"), htmlContent);
      created = true;
    }

    return { docArtifact, artboardArtifact, created };
  }

  /**
   * 搜索可供 Composer Attachment 引用的真实批注和图元（模式 B）
   */
  async searchAttachments(query: string, projectDir?: string) {
    const q = query.trim().toLowerCase();
    const pDir = this.getProjectDir(projectDir);
    const artifacts = await this.listArtifacts(pDir);
    const items: Array<{
      id: string;
      identifier: string;
      title: string;
      subtitle?: string;
      url: string;
      text: string;
      resourceType: string;
    }> = [];

    for (const art of artifacts) {
      const comments = await this.getComments(art.artifact, pDir);
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

      if (art.artifact.startsWith("document/")) {
        const blocks = await this.readDocumentBlocks(art.artifact, pDir);
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

      if (art.artifact.startsWith("artboard/")) {
        const boards = this.readArtboardBoards(art.artifact, pDir);
        for (const board of boards) {
          if (!q || board.id.toLowerCase().includes(q) || (board.name && board.name.toLowerCase().includes(q))) {
            items.push({
              id: `ryugi-board-${art.artifact}-${board.id}`,
              identifier: `#方案-${board.id}`,
              title: `[Ryugi 画板方案] ${board.name || board.id}`,
              subtitle: `画板: ${art.artifact} (尺寸: ${board.width}x${board.height})`,
              url: `http://localhost:27319/${art.artifact}#${board.id}`,
              text: `【Ryugi 画板方案引用】\n- 画板工件: ${art.artifact}\n- 方案标识: ${board.id}\n- 方案名称: ${board.name}\n- 尺寸坐标: ${board.width}x${board.height}\n- 对应渲染文件: ${board.file}\n`,
              resourceType: "ryugi-artboard-element",
            });
          }
        }
      }
    }

    return { items };
  }
}

export const realRyugiBridge = new RealRyugiBridge();
