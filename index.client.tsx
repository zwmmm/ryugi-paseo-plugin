import { openExternalUrl, type PluginButtonRegistration, type PluginText, type PluginClientContext } from "@getpaseo/plugin/client";
import { MonitorNotice, monitorNoticeSchema, parseMonitorNotice } from "./client/MonitorNotice.js";
import { messages } from "./client/messages.js";
import { sessionDataRpc, workspaceChanges } from "./shared/contracts.js";

export default function contribute(client: PluginClientContext) {
  const removeTransformer = client.addTimelineTransformer({
    id: "ryugi-monitor-notice",
    query: { itemType: "user_message" },
    transform({ item }) {
      const data = parseMonitorNotice(item.text);
      if (data) return { items: [{ type: "plugin", kind: "ryugi-monitor-notice", version: 1, data }] };
    },
  });
  const removeRenderer = client.addTimelineRenderer({ kind: "ryugi-monitor-notice", version: 1, schema: monitorNoticeSchema, Component: MonitorNotice });
  const lifetime = new AbortController();
  const agents = new Map<string, { workspaceId: string; checking: boolean; pending: boolean; doc?: PluginButtonRegistration<PluginText>; art?: PluginButtonRegistration<PluginText>; docUrl?: string; artUrl?: string; stopWatch?: () => void }>();
  const remove = (id: string) => { const state = agents.get(id); state?.stopWatch?.(); state?.doc?.remove(); state?.art?.remove(); agents.delete(id); };
  const check = async (id: string) => {
    const state = agents.get(id);
    if (!state || lifetime.signal.aborted) return;
    if (state.checking) { state.pending = true; return; }
    state.checking = true;
    try {
      const result = await client.rpc(sessionDataRpc, { agentId: id, workspaceId: state.workspaceId });
      if (lifetime.signal.aborted || agents.get(id) !== state) return;
      const register = (kind: "document" | "artboard") => client.addComposerPill({
        id: kind === "document" ? "ryugi-document" : "ryugi-artboard", workspaceId: state.workspaceId, agentId: id,
        button: { title: messages.message(kind), icon: kind === "document" ? "FileText" : "LayoutGrid", behavior: { kind: "action", onPress: () => { const url = kind === "document" ? state.docUrl : state.artUrl; if (url) return openExternalUrl(url); } } },
      });
      state.docUrl = result.artifacts.find((x) => x.artifact.startsWith("document/"))?.url;
      state.artUrl = result.artifacts.find((x) => x.artifact.startsWith("artboard/"))?.url;
      const hasDoc = !!state.docUrl;
      const hasArt = !!state.artUrl;
      if (hasDoc && !state.doc) state.doc = register("document");
      if (!hasDoc && state.doc) { state.doc.remove(); state.doc = undefined; }
      if (hasArt && !state.art) state.art = register("artboard");
      if (!hasArt && state.art) { state.art.remove(); state.art = undefined; }
    } catch (error) { console.error("[Ryugi] 会话同步失败", error); }
    finally { state.checking = false; if (state.pending) { state.pending = false; void check(id); } }
  };
  const register = (agent: { id: string; workspaceId?: string | null }) => {
    if (!agent.workspaceId) { remove(agent.id); return; }
    const old = agents.get(agent.id);
    if (!old || old.workspaceId !== agent.workspaceId) {
      remove(agent.id);
      const state = { workspaceId: agent.workspaceId, checking: false, pending: false, stopWatch: undefined as (() => void) | undefined };
      agents.set(agent.id, state);
      const watch = client.subscribe(workspaceChanges, { workspaceId: agent.workspaceId }, () => { void check(agent.id); }, { signal: lifetime.signal, onClosed: ({ error }) => { if (error) console.error("[Ryugi] 文件订阅失败", error); } });
      state.stopWatch = watch;
      void watch.ready.catch((error) => { if (!lifetime.signal.aborted) console.error("[Ryugi] 文件订阅失败", error); });
    }
    void check(agent.id);
  };
  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ subscription }) => {
    subscription.subscribe({
      snapshot: ({ entries }) => { for (const id of agents.keys()) remove(id); for (const { agent } of entries) register(agent); },
      update: (message) => { if (message.type !== "agent_update") return; const update = message.payload; if (update.kind === "upsert") register(update.agent); else remove(update.agentId); },
    });
  }).catch((error) => { if (!lifetime.signal.aborted) console.error("[Ryugi] 会话订阅失败", error); });
  const timer = setInterval(() => { for (const id of agents.keys()) void check(id); }, 60000);
  return () => { lifetime.abort(); clearInterval(timer); for (const id of agents.keys()) remove(id); removeTransformer(); removeRenderer(); };
}
