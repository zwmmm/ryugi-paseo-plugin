import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { DocumentPanel } from "./client/DocumentPanel.js";
import { ArtboardPanel } from "./client/ArtboardPanel.js";
import { ryugiAttachments, initSessionSingletonRpc } from "./shared/contracts.js";

export default function contribute(client: PluginClientContext) {
  // 1. 注册工作区面板 (Agent Context Panel)
  const removeDocPanel = client.addWorkspacePanel({
    id: "ryugi-document",
    title: "需求 PRD 文档",
    icon: "FileText",
    context: "agent",
    locations: ["workspace"],
    Component: DocumentPanel,
  });

  const removeArtboardPanel = client.addWorkspacePanel({
    id: "ryugi-artboard",
    title: "需求原型画板",
    icon: "LayoutGrid",
    context: "agent",
    locations: ["workspace"],
    Component: ArtboardPanel,
  });

  // 2. 注册 Composer 附件源（通过 @ 实时引用段落规范与真实批注）
  const removeAttachmentSource = client.addAttachmentSource(ryugiAttachments);

  // 3. 在 Agent 对话输入框上方悬浮两个入口 (Composer Pills)
  const pills = new Map<string, { docPill: PluginButtonRegistration; artPill: PluginButtonRegistration }>();
  const lifetime = new AbortController();

  const registerPillsForAgent = (agent: { id: string; workspaceId?: string | null }) => {
    if (lifetime.signal.aborted || !agent.workspaceId) return;
    const agentId = agent.id;
    const workspaceId = agent.workspaceId;

    // 清理已存在的注册
    const existing = pills.get(agentId);
    if (existing) {
      existing.docPill.remove();
      existing.artPill.remove();
      pills.delete(agentId);
    }

    const docPill = client.addComposerPill({
      id: "ryugi-doc-pill",
      workspaceId,
      agentId,
      button: {
        title: "PRD 文档",
        label: "PRD 文档",
        icon: "FileText",
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel("ryugi-document", { workspaceId, agentId });
          },
        },
      },
    });

    const artPill = client.addComposerPill({
      id: "ryugi-art-pill",
      workspaceId,
      agentId,
      button: {
        title: "原型画板",
        label: "原型画板",
        icon: "LayoutGrid",
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel("ryugi-artboard", { workspaceId, agentId });
          },
        },
      },
    });

    pills.set(agentId, { docPill, artPill });
  };

  const removeAllPills = () => {
    for (const { docPill, artPill } of pills.values()) {
      docPill.remove();
      artPill.remove();
    }
    pills.clear();
  };

  // 订阅 Agent 列表，确保所有会话的输入框上方都有两个常驻悬浮入口
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAllPills();
          for (const { agent } of entries) {
            registerPillsForAgent(agent);
          }
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") {
            registerPillsForAgent(update.agent);
          } else {
            const existing = pills.get(update.agentId);
            if (existing) {
              existing.docPill.remove();
              existing.artPill.remove();
              pills.delete(update.agentId);
            }
          }
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) {
        console.error("[Ryugi] Failed to subscribe to agents for composer pills:", error);
      }
    });

  // 4. 注册快捷 Slash Command: /ryugi
  const removeSlashCommand = client.addSlashCommand({
    name: "ryugi",
    description: "为当前会话初始化专属 PRD 文档与原型画板工作台",
    argumentHint: "[需求标题]",
    context: "agent",
    async onSubmit({ args, agent, rpc, openPanel }) {
      await rpc(initSessionSingletonRpc, {
        agentId: agent.id,
        title: args || undefined,
      });
      openPanel("ryugi-document");
    },
  });

  return () => {
    lifetime.abort();
    removeAllPills();
    removeDocPanel();
    removeArtboardPanel();
    removeAttachmentSource();
    removeSlashCommand();
  };
}
