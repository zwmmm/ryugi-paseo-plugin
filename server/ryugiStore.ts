import type {
  DocumentArtifact,
  ArtboardArtifact,
  RyugiCommentThread,
} from "../shared/types.js";

class RyugiStore {
  private documents: DocumentArtifact[] = [
    {
      id: "architecture-spec",
      title: "系统架构与模块设计规范 (RFC-001)",
      blocks: [
        {
          id: "block-1",
          tag: "h1",
          text: "1. 架构总览与交互闭环",
          line: 1,
        },
        {
          id: "block-2",
          tag: "p",
          text: "前端采用双 Panel 机制（文档面板与画板面板）并列展示。通过 Paseo 客户端插件原生的 AttachmentSource 机制将评论打通给 Agent 对话框。",
          line: 3,
        },
        {
          id: "block-3",
          tag: "ask",
          text: "【Agent提问】关于数据同步策略：画板坐标与属性修改是采用乐观更新还是通过 RPC 等待 Daemon 返回？",
          askOptions: ["A: 乐观更新立即反馈", "B: 强一致性 RPC 确认"],
          selectedOption: "A: 乐观更新立即反馈",
          line: 7,
        },
        {
          id: "block-4",
          tag: "h2",
          text: "2. 评论与图元标注规范",
          line: 11,
        },
        {
          id: "block-5",
          tag: "p",
          text: "用户针对具体句子的批注应附带目标 Block ID 与引用原文。进入 Agent 提示词时使用标准 Markdown 引用格式格式化。",
          line: 13,
        },
      ],
    },
  ];

  private artboards: ArtboardArtifact[] = [
    {
      id: "dashboard-layout",
      title: "多方案布局设计画板 (Artboard)",
      variants: [
        {
          id: "variant-a",
          name: "方案 A：三栏分屏 (Chat | Doc | Canvas)",
          description: "适合桌面大宽屏环境，会话流、规范文档与白板画板并排平铺。",
          elements: [
            {
              id: "node-1",
              tag: "panel-chat",
              name: "Agent 对话栏",
              x: 0,
              y: 0,
              width: 320,
              height: 480,
              color: "#3b82f6",
              text: "主聊天流 & 输入框",
              status: "pass",
            },
            {
              id: "node-2",
              tag: "panel-doc",
              name: "设计文档与批注栏",
              x: 340,
              y: 0,
              width: 400,
              height: 480,
              color: "#10b981",
              text: "Markdown / Asks / 批注",
              status: "pass",
            },
            {
              id: "node-3",
              tag: "panel-canvas",
              name: "画板对比栏",
              x: 760,
              y: 0,
              width: 440,
              height: 480,
              color: "#f59e0b",
              text: "Artboard / Whiteboard",
              status: "feedback",
            },
          ],
        },
        {
          id: "variant-b",
          name: "方案 B：双主栏 + 抽屉切换 (Chat + Tabs)",
          description: "适合紧凑型笔记本屏，文档与画板作为右侧 Tabs 自由切换。",
          elements: [
            {
              id: "node-b1",
              tag: "panel-chat",
              name: "Agent 主对话窗口",
              x: 0,
              y: 0,
              width: 420,
              height: 480,
              color: "#3b82f6",
              text: "集成 Composer 附件胶囊",
              status: "idle",
            },
            {
              id: "node-b2",
              tag: "panel-tabbed",
              name: "工件工作台 Tab 容器",
              x: 440,
              y: 0,
              width: 580,
              height: 480,
              color: "#8b5cf6",
              text: "[Tab: 文档] | [Tab: 画板]",
              status: "idle",
            },
          ],
        },
      ],
    },
  ];

  private comments: RyugiCommentThread[] = [
    {
      id: "comm-1",
      artifactKind: "document",
      artifactId: "architecture-spec",
      targetId: "block-2",
      targetName: "文档第 3 行",
      quote: "通过 Paseo 客户端插件原生的 AttachmentSource 机制",
      text: "请确保 Attachment 的 text 字段包含完整的上下文，这样 Agent 能够准确定位讨论的句段。",
      author: "human",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      resolved: false,
    },
    {
      id: "comm-2",
      artifactKind: "artboard",
      artifactId: "dashboard-layout",
      targetId: "node-3",
      targetName: "画板图元: 画板对比栏",
      quote: "Artboard / Whiteboard",
      text: "画布在窄屏下需要支持缩放与平移，建议允许双指 Pinch 或 ⌘ + 滚轮缩放。",
      author: "human",
      createdAt: new Date(Date.now() - 1800000).toISOString(),
      resolved: false,
    },
  ];

  public getAll() {
    return {
      documents: this.documents,
      artboards: this.artboards,
      comments: this.comments,
    };
  }

  public addComment(input: {
    artifactKind: "document" | "artboard" | "whiteboard";
    artifactId: string;
    targetId: string;
    targetName: string;
    quote?: string;
    text: string;
  }) {
    const newComment: RyugiCommentThread = {
      id: `comm-${Date.now()}`,
      artifactKind: input.artifactKind,
      artifactId: input.artifactId,
      targetId: input.targetId,
      targetName: input.targetName,
      quote: input.quote,
      text: input.text,
      author: "human",
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    this.comments.unshift(newComment);
    return newComment.id;
  }

  public updateElementStatus(
    artboardId: string,
    variantId: string,
    elementId: string,
    status: "idle" | "feedback" | "pass" | "reject"
  ) {
    const artboard = this.artboards.find((a) => a.id === artboardId);
    if (!artboard) return false;
    const variant = artboard.variants.find((v) => v.id === variantId);
    if (!variant) return false;
    const elem = variant.elements.find((e) => e.id === elementId);
    if (!elem) return false;
    elem.status = status;
    return true;
  }

  /**
   * Search for Attachment Source (Pattern B)
   * Formats annotations and nodes into prompt-ready context blocks for Agent
   */
  public searchAttachments(query: string) {
    const q = query.trim().toLowerCase();
    const items: Array<{
      id: string;
      identifier: string;
      title: string;
      subtitle?: string;
      url: string;
      text: string;
      resourceType: string;
    }> = [];

    // 1. Search in Comments / Annotations
    for (const c of this.comments) {
      if (
        !q ||
        c.text.toLowerCase().includes(q) ||
        (c.quote && c.quote.toLowerCase().includes(q)) ||
        c.targetName.toLowerCase().includes(q)
      ) {
        items.push({
          id: `comment-${c.id}`,
          identifier: `#批注-${c.id.slice(-4)}`,
          title: `[批注] ${c.targetName}: "${c.text.slice(0, 30)}${c.text.length > 30 ? "..." : ""}"`,
          subtitle: c.quote ? `引用原文: "${c.quote.slice(0, 40)}..."` : `归属: ${c.artifactKind}/${c.artifactId}`,
          url: `https://ryugi.local/${c.artifactKind}/${c.artifactId}#${c.targetId}`,
          text: `【Ryugi 批注引用】\n- 目标: ${c.targetName} (${c.artifactKind}/${c.artifactId})\n${c.quote ? `- 原文: "${c.quote}"\n` : ""}- 评论内容: ${c.text}\n- 提出时间: ${c.createdAt}\n`,
          resourceType: "ryugi-comment",
        });
      }
    }

    // 2. Search in Document Asks / Key Blocks
    for (const doc of this.documents) {
      for (const block of doc.blocks) {
        if (
          !q ||
          block.text.toLowerCase().includes(q) ||
          doc.title.toLowerCase().includes(q)
        ) {
          const isAsk = block.tag === "ask";
          items.push({
            id: `doc-${doc.id}-${block.id}`,
            identifier: `#文档-${block.id}`,
            title: isAsk
              ? `[文档疑问] ${block.text.slice(0, 40)}...`
              : `[设计规范] 第 ${block.line} 行: "${block.text.slice(0, 35)}..."`,
            subtitle: doc.title,
            url: `https://ryugi.local/document/${doc.id}#${block.id}`,
            text: `【Ryugi 文档引用】\n- 文档: ${doc.title} (${doc.id})\n- 行号/区块: 第 ${block.line} 行 (${block.id})\n- 内容:\n${block.text}\n${block.selectedOption ? `- 当前选择: ${block.selectedOption}\n` : ""}`,
            resourceType: "ryugi-doc-block",
          });
        }
      }
    }

    // 3. Search in Artboard Variants & Elements
    for (const art of this.artboards) {
      for (const variant of art.variants) {
        for (const el of variant.elements) {
          if (
            !q ||
            el.name.toLowerCase().includes(q) ||
            variant.name.toLowerCase().includes(q) ||
            (el.text && el.text.toLowerCase().includes(q))
          ) {
            items.push({
              id: `art-${art.id}-${variant.id}-${el.id}`,
              identifier: `#画板-${el.id}`,
              title: `[画板图元] ${variant.name} -> ${el.name} (${el.status})`,
              subtitle: `坐标: (${el.x}, ${el.y}) 尺寸: ${el.width}x${el.height}`,
              url: `https://ryugi.local/artboard/${art.id}#${variant.id}-${el.id}`,
              text: `【Ryugi 画板图元引用】\n- 画板: ${art.title}\n- 方案: ${variant.name}\n- 图元组件: ${el.name} (<${el.tag}>)\n- 状态: ${el.status.toUpperCase()}\n- 布局参数: x=${el.x}, y=${el.y}, w=${el.width}, h=${el.height}\n- 附带描述: ${el.text ?? "无"}\n`,
              resourceType: "ryugi-artboard-element",
            });
          }
        }
      }
    }

    return { items };
  }
}

export const ryugiStore = new RyugiStore();
