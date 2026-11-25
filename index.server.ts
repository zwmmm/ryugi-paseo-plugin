import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { sessionDataRpc, workspaceChanges } from "./shared/contracts.js";
import { realRyugiBridge } from "./server/realRyugiBridge.js";
import { createMonitorSessions } from "./server/monitorSessions.js";
import { getPrivateRuntime } from "./server/privateRuntime.js";
import { ryugiInstructions, createRyugiTool } from "./server/workflowIntegration.js";
import { watchArtifacts } from "./server/watchArtifacts.js";

export default function contribute(server: PluginServerContext) {
  const runtime = getPrivateRuntime();
  const monitors = createMonitorSessions(undefined, runtime);
  const openedArtifacts = new Map<string, Array<{ artifact: string; url: string }>>();
  let disposed = false;
  server.handle(workspaceChanges, async ({ workspaceId }, { paseo, push, signal }) => {
    const workspace = paseo.workspaces.ref(workspaceId);
    const ws = workspace.current() || await workspace.refresh();
    if (!ws) throw new Error("工作区不可用");
    if (signal.aborted) return;
    const stop = watchArtifacts(runtime.getProjectDir(ws.workspaceDirectory || ws.projectRootPath), () => {
      void push({ changed: true }).catch((error) => console.error("[Ryugi] 推送失败", error));
    });
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => { stop(); resolve(); }, { once: true });
      if (signal.aborted) { stop(); resolve(); }
    });
  });
  const sessionData = async ({ agentId, workspaceId }: { agentId: string; workspaceId: string }, { paseo }: PluginHandlerContext) => {
    const workspace = paseo.workspaces.ref(workspaceId);
    const ws = workspace.current() || await workspace.refresh();
    if (!ws) throw new Error("工作区不可用");
    const agent = paseo.agents.ref(agentId);
    const snapshot = agent.current() || (await agent.refresh())?.agent;
    if (!snapshot || snapshot.workspaceId !== workspaceId) throw new Error("会话不属于当前工作区");
    const texts: string[] = [];
    let cursor: { epoch: string; seq: number } | undefined;
    do {
      const page = await agent.timeline.refetch({ direction: cursor ? "before" : "tail", cursor, limit: 200 });
      for (const entry of page.entries) {
        if (entry.item.type === "assistant_message") texts.push(entry.item.text);
      }
      cursor = page.hasOlder && page.startCursor ? page.startCursor : undefined;
    } while (cursor);
    const projectDir = runtime.getProjectDir(ws.workspaceDirectory || ws.projectRootPath);
    const artifacts = await realRyugiBridge.sessionArtifacts(projectDir, [...texts, ...((openedArtifacts.get(agentId) || []).map(({ url }) => url))]);
    if (!disposed) monitors.bind(agentId, workspaceId, artifacts.map(({ artifact }) => ({ project: projectDir, artifact })), paseo);
    return { artifacts };
  };
  server.handle(sessionDataRpc, sessionData);
  const refresh = (agentId: string, workspaceId: string | null, context: PluginHandlerContext) => {
    if (workspaceId && !disposed) void sessionData({ agentId, workspaceId }, context).catch((error) => console.error("[Ryugi] monitor 绑定失败", error));
  };
  const removeTurnHook = server.addHook("agent.turn.after", async ({ agent }, context) => { refresh(agent.id, agent.workspaceId, context); });
  const removeArchiveHook = server.addHook("agent.archive.after", async ({ agent }) => { monitors.remove(agent.id); openedArtifacts.delete(agent.id); });
  const removeOpenHook = server.addHook("agent.open.before", async ({ request }, context) => {
    if (request.purpose !== "interactive" || !request.workspaceId) return;
    const workspace = context.paseo.workspaces.ref(request.workspaceId);
    const ws = workspace.current() || await workspace.refresh();
    if (!ws) throw new Error("Ryugi 工作区不可用");
    const projectDir = runtime.getProjectDir(ws.workspaceDirectory || ws.projectRootPath);
    setTimeout(() => refresh(request.agentId, request.workspaceId, context), 0);
    const tool = createRyugiTool(runtime, projectDir, async (output) => {
      const artifacts = await realRyugiBridge.sessionArtifacts(projectDir, [output]);
      const existing = openedArtifacts.get(request.agentId) || [];
      const merged = [...new Map([...existing, ...artifacts].map((a) => [a.artifact, a])).values()];
      openedArtifacts.set(request.agentId, merged);
      if (!disposed) monitors.bind(request.agentId, request.workspaceId!, merged.map(({ artifact }) => ({ project: projectDir, artifact })), context.paseo);
    });
    return { ...request, tools: [...request.tools, tool], appendSystemPrompt: [...(request.appendSystemPrompt || []), ryugiInstructions(runtime, projectDir, request.cwd)] };
  });
  return () => { disposed = true; removeTurnHook(); removeArchiveHook(); removeOpenHook(); monitors.close(); };
}
