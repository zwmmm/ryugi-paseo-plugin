import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";

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
 * 3. 检查全局 cache release 中的 cli.cjs
 * 4. 检查当前工作区本地源码的 ryugi.cjs
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

  const candidates = [
    path.join(os.homedir(), ".cache/ryugi/artifacts/1.105.3/node_modules/ryugi-artifacts/dist/cli.cjs"),
    "/Users/wayne/.lody/chats/0cf6159c-f2a4-4e62-b672-a4817b5b8fde/ryugi-repo/skills/artifacts/app/ryugi.cjs",
    path.resolve(process.cwd(), "ryugi-repo/skills/artifacts/app/ryugi.cjs"),
    path.resolve(process.cwd(), "../ryugi-repo/skills/artifacts/app/ryugi.cjs"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return "ryugi";
}

/**
 * 探测默认项目目录：
 * 1. 优先使用 RYUGI_PROJECT_DIR
 * 2. 检查已知本地 ryugi-repo 工作区
 * 3. 检查当前 cwd 下的 ryugi-repo 或 .ryugi
 */
function resolveDefaultProjectDir(): string {
  if (process.env.RYUGI_PROJECT_DIR && fs.existsSync(process.env.RYUGI_PROJECT_DIR)) {
    return process.env.RYUGI_PROJECT_DIR;
  }

  const knownWorkspace = "/Users/wayne/.lody/chats/0cf6159c-f2a4-4e62-b672-a4817b5b8fde/ryugi-repo";
  if (fs.existsSync(knownWorkspace)) {
    return knownWorkspace;
  }

  const cwdRepo = path.resolve(process.cwd(), "ryugi-repo");
  if (fs.existsSync(cwdRepo)) return cwdRepo;

  if (fs.existsSync(path.resolve(process.cwd(), ".ryugi"))) {
    return process.cwd();
  }

  return process.cwd();
}

export class RealRyugiBridge {
  private customCliPath: string | null = null;
  private customProjectDir: string | null = null;
  private serverUrl: string | null = null;
  private embedProxyServer: http.Server | null = null;
  private embedProxyPort: number = 27325;

  constructor(cliPath?: string, projectDir?: string) {
    if (cliPath) this.customCliPath = cliPath;
    if (projectDir) this.customProjectDir = projectDir;
  }

  public getCliPath(): string {
    return this.customCliPath || resolveRyugiCli();
  }

  public getProjectDir(override?: string): string {
    if (override && fs.existsSync(override)) {
      if (fs.existsSync(path.join(override, "ryugi-repo"))) {
        return path.join(override, "ryugi-repo");
      }
      return override;
    }
    return this.customProjectDir || resolveDefaultProjectDir();
  }

  public setProjectDir(dir: string) {
    this.customProjectDir = dir;
  }

  /**
   * 启动内置的无 CSP 代理服务（端口 27325）：
   * 专用于在 Paseo 面板中无障碍嵌入真实的 Ryugi Web UI，
   * 移除阻止 iframe 加载的 frame-ancestors 与 CSP 头，并代理 WebSocket。
   */
  async ensureEmbedProxy(): Promise<string> {
    if (this.embedProxyServer) {
      return `http://localhost:${this.embedProxyPort}`;
    }

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        const upstreamPort = 27319;
        const options: http.RequestOptions = {
          hostname: "localhost",
          port: upstreamPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `localhost:${upstreamPort}` },
        };

        const proxyReq = http.request(options, (proxyRes) => {
          const headers = { ...proxyRes.headers };
          // 剥除阻止 iframe 嵌入的安全限制头
          delete headers["content-security-policy"];
          delete headers["content-security-policy-report-only"];
          delete headers["x-frame-options"];
          headers["access-control-allow-origin"] = "*";
          headers["access-control-allow-headers"] = "*";

          res.writeHead(proxyRes.statusCode || 200, headers);
          proxyRes.pipe(res, { end: true });
        });

        proxyReq.on("error", (err) => {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Ryugi embed proxy error: " + err.message);
        });

        req.pipe(proxyReq, { end: true });
      });

      // 代理 WebSocket 升级请求以保证实时协同与批注连接
      server.on("upgrade", (req, socket, head) => {
        const upstreamPort = 27319;
        const proxyReq = http.request({
          hostname: "localhost",
          port: upstreamPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `localhost:${upstreamPort}` },
        });

        proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              Object.entries(proxyRes.headers)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\r\n") +
              "\r\n\r\n"
          );
          if (proxyHead && proxyHead.length) {
            socket.unshift(proxyHead);
          }
          proxySocket.pipe(socket);
          socket.pipe(proxySocket);
        });

        proxyReq.on("error", () => {
          socket.destroy();
        });

        proxyReq.end();
      });

      server.listen(this.embedProxyPort, () => {
        this.embedProxyServer = server;
        resolve(`http://localhost:${this.embedProxyPort}`);
      });

      server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          this.embedProxyPort += 1;
          server.listen(this.embedProxyPort);
        } else {
          resolve("http://localhost:27319");
        }
      });
    });
  }

  /**
   * 确保 Ryugi 本地 server 启动，并获取其访问基础地址
   */
  async ensureServer(projectDir?: string, artifact?: string): Promise<string> {
    if (this.serverUrl) return this.serverUrl;
    const pDir = this.getProjectDir(projectDir);
    const cli = this.getCliPath();
    const art = artifact || "document/comment-demo";

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
    const docTitle = title || `需求会话 ${shortId} 专属 PRD`;

    const docDir = path.join(pDir, ".ryugi/artifacts", docArtifact);
    const artDir = path.join(pDir, ".ryugi/artifacts", artboardArtifact);

    let created = false;

    // 1. 初始化会话专属文档单例
    if (!fs.existsSync(docDir)) {
      fs.mkdirSync(docDir, { recursive: true });
      const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<article id="art-${shortId}">
  <h1 id="title-${shortId}">${docTitle}</h1>
  <p id="desc-${shortId}">本篇 PRD 与画板是当前需求会话专属的唯一工件。所有后续开发与原型迭代均在此处原位更新。</p>
  <h2 id="scope-${shortId}">需求范围与规格</h2>
  <p id="scope-content-${shortId}">请在下方的画板与段落中补充具体业务规则与边界约束。</p>
</article>
`;
      fs.writeFileSync(path.join(docDir, "doc.xml"), docXml);
      fs.writeFileSync(path.join(docDir, "comments.json"), JSON.stringify({ version: "1.0", threads: [] }, null, 2));
      created = true;
    }

    // 2. 初始化会话专属画板单例
    if (!fs.existsSync(artDir)) {
      fs.mkdirSync(path.join(artDir, "boards"), { recursive: true });
      const canvasJson = {
        version: "1.0",
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
