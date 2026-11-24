import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DocumentPanel } from "./client/DocumentPanel.js";
import { ArtboardPanel } from "./client/ArtboardPanel.js";
import { ryugiAttachments } from "./shared/contracts.js";

export default function contribute(client: PluginClientContext) {
  // 1. 注册文档面板 (Document Panel)
  const removeDocPanel = client.addWorkspacePanel({
    id: "ryugi-document",
    title: "Ryugi 文档与批注",
    icon: "FileText",
    context: "workspace",
    locations: ["workspace"],
    Component: DocumentPanel,
  });

  // 2. 注册画板面板 (Artboard Panel)
  const removeArtboardPanel = client.addWorkspacePanel({
    id: "ryugi-artboard",
    title: "Ryugi 设计画板",
    icon: "LayoutGrid",
    context: "workspace",
    locations: ["workspace"],
    Component: ArtboardPanel,
  });

  // 3. 模式 B 核心：注册 Composer Attachment Source（打通输入框与标注）
  // 用户在 Agent 输入框输入 @ 或点击附件按钮时，可实时检索、点选并挂载文档批注或画板图元
  const removeAttachmentSource = client.addAttachmentSource(ryugiAttachments);

  return () => {
    removeDocPanel();
    removeArtboardPanel();
    removeAttachmentSource();
  };
}
