import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DocumentPanel } from "./client/DocumentPanel.js";
import { ArtboardPanel } from "./client/ArtboardPanel.js";
import { ryugiAttachments, initSessionSingletonRpc } from "./shared/contracts.js";

export default function contribute(client: PluginClientContext) {
  // 1. 注册需求会话文档面板 (Agent Context Panel)
  const removeDocPanel = client.addWorkspacePanel({
    id: "ryugi-document",
    title: "需求 PRD 文档",
    icon: "FileText",
    context: "agent",
    locations: ["workspace"],
    Component: DocumentPanel,
  });

  // 2. 注册需求会话画板面板 (Agent Context Panel)
  const removeArtboardPanel = client.addWorkspacePanel({
    id: "ryugi-artboard",
    title: "需求原型画板",
    icon: "LayoutGrid",
    context: "agent",
    locations: ["workspace"],
    Component: ArtboardPanel,
  });

  // 3. 注册 Composer 附件源（打通输入框与标注）
  const removeAttachmentSource = client.addAttachmentSource(ryugiAttachments);

  // 4. 注册快捷 Slash Command: /ryugi 快速初始化当前会话单例并打开面板
  const removeSlashCommand = client.addSlashCommand({
    name: "ryugi",
    description: "为当前会话初始化专属 PRD 文档与画板工作台",
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
    removeDocPanel();
    removeArtboardPanel();
    removeAttachmentSource();
    removeSlashCommand();
  };
}
