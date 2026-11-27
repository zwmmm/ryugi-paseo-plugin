import path from "node:path";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { remoteAccessSettings, remoteArtifactRpc, startTunnelRpc, stopTunnelRpc, tunnelStatus } from "./shared/remoteAccess.js";
import { createLocalProbe, createQuickTunnel } from "./server/quickTunnel.js";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { sessionDataRpc, workspaceChanges } from "./shared/contracts.js";
import { browserChanges, browserSettings, defaultArtifactBrowser } from "./shared/browserSettings.js";
import { realRyugiBridge } from "./server/realRyugiBridge.js";
import { createMonitorSessions } from "./server/monitorSessions.js";
import { getPrivateRuntime } from "./server/privateRuntime.js";
import { registerRuntimeUpdates } from "./server/runtimeUpdate.js";
import { ryugiInstructions, createRyugiTool } from "./server/workflowIntegration.js";
import { watchArtifacts } from "./server/watchArtifacts.js";

export default function contribute(server: PluginServerContext) {
  const preferences = server.registerSettings(browserSettings);
  server.handle(browserChanges, async (_input, { push, signal }) => {
    let changed = false;
    const unsubscribe = preferences.subscribe((state) => {
      changed = true;
      return push({ browser: state.status === "ready" ? state.values.browser : defaultArtifactBrowser });
    });
    try {
      const state = await preferences.read();
      if (!changed) await push({ browser: state.status === "ready" ? state.values.browser : defaultArtifactBrowser });
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    } finally {
      await unsubscribe();
    }
  });
  const runtime = getPrivateRuntime();
  const stopRuntimeUpdates = registerRuntimeUpdates(server, runtime.runtimeDir);
  const remoteSettings = server.registerSettings(remoteAccessSettings);
  const localProbe = createLocalProbe();
  const tunnel = createQuickTunnel(path.join(runtime.runtimeDir, "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared"));
  let tunnelGeneration = 0;
  const stopTunnel = () => {
    tunnelGeneration++;
    return tunnel.stop();
  };
  const unsubscribeRemote = remoteSettings.subscribe(() => { stopTunnel(); });
  server.handle(stopTunnelRpc, () => ({ stopped: stopTunnel() }));
  server.handle(tunnelStatus, async (_input, { push, signal }) => {
    if (signal.aborted) return;
    const unsubscribe = tunnel.subscribe((active) => {
      void push({ active }).catch((error) => {
        if (!signal.aborted) console.error("[Ryugi] 隧道状态推送失败", error);
      });
    });
    try {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    } finally {
      unsubscribe();
    }
  });
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
  server.handle(sessionDataRpc, async (input, context) => {
    const { artifacts } = await sessionData(input, context);
    return artifacts.length ? { artifacts, localProbe: await localProbe.url() } : { artifacts };
  });
  async function openTunnel(resolveUrl: () => Promise<string>) {
    const generation = tunnelGeneration;
    const settings = await remoteSettings.read();
    if (settings.status !== "ready" || !settings.values.password) {
      throw new Error("请先在插件的「远程访问」里设置访问密码。");
    }
    const url = await resolveUrl();
    if (disposed || generation !== tunnelGeneration) throw new Error("Artideck tunnel was closed. Open it again to start a new tunnel.");
    return { url: await tunnel.open(url, settings.values.password) };
  }
  server.handle(startTunnelRpc, () => openTunnel(async () => {
    const projectDir = runtime.getProjectDir(runtime.runtimeDir);
    const local = new URL(await realRyugiBridge.startUrl(projectDir));
    return new URL("/", local).href;
  }));
  server.handle(remoteArtifactRpc, ({ url }) => openTunnel(async () => {
    const local = URL.parse(url);
    const info = JSON.parse(await readFile(path.join(runtime.serverHome, "server-info"), "utf8"));
    const ryugi = typeof info.url === "string" ? URL.parse(info.url) : null;
    if (!local || !ryugi?.port || local.port !== ryugi.port) {
      throw new Error("Artideck 服务端口已变更，请刷新会话工件入口。");
    }
    return local.href;
  }));
  const refresh = (agentId: string, workspaceId: string | null, context: PluginHandlerContext) => {
    if (workspaceId && !disposed) void sessionData({ agentId, workspaceId }, context).catch((error) => console.error("[Artideck] monitor 绑定失败", error));
  };
  const removeTurnHook = server.addHook("agent.turn.after", async ({ agent }, context) => { refresh(agent.id, agent.workspaceId, context); });
  const removeArchiveHook = server.addHook("agent.archive.after", async ({ agent }) => { monitors.remove(agent.id); openedArtifacts.delete(agent.id); });
  const removeOpenHook = server.addHook("agent.open.before", async ({ request }, context) => {
    if (request.purpose !== "interactive" || !request.workspaceId) return;
    const workspace = context.paseo.workspaces.ref(request.workspaceId);
    const ws = workspace.current() || await workspace.refresh();
    if (!ws) throw new Error("Artideck 工作区不可用");
    const sessionRuntime = getPrivateRuntime();
    const projectDir = sessionRuntime.getProjectDir(ws.workspaceDirectory || ws.projectRootPath);
    setTimeout(() => refresh(request.agentId, request.workspaceId, context), 0);
    const tool = createRyugiTool(sessionRuntime, projectDir, async (output) => {
      const artifacts = await realRyugiBridge.sessionArtifacts(projectDir, [output]);
      const existing = openedArtifacts.get(request.agentId) || [];
      const merged = [...new Map([...existing, ...artifacts].map((a) => [a.artifact, a])).values()];
      openedArtifacts.set(request.agentId, merged);
      if (!disposed) monitors.bind(request.agentId, request.workspaceId!, merged.map(({ artifact }) => ({ project: projectDir, artifact })), context.paseo);
    });
    return { ...request, tools: [...request.tools, tool], appendSystemPrompt: [...(request.appendSystemPrompt || []), ryugiInstructions(sessionRuntime, projectDir, request.cwd)] };
  });
  return async () => { disposed = true; stopRuntimeUpdates(); localProbe.close(); tunnel.stop(); await unsubscribeRemote(); removeTurnHook(); removeArchiveHook(); removeOpenHook(); monitors.close(); };
}
