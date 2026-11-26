import { openExternalUrl, useTranslation, type PluginButtonRegistration, type PluginText, type PluginClientContext, type PluginScreenProps } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { MonitorNotice, monitorNoticeSchema, parseMonitorNotice } from "./client/MonitorNotice.js";
import { RemoteAccessSettings } from "./client/RemoteAccessSettings.js";
import { canOpenLocally } from "./client/artifactUrl.js";
import { remoteArtifactRpc } from "./shared/remoteAccess.js";
import { BrowserSettings } from "./client/BrowserSettings.js";
import { DesignSettings } from "./client/DesignSettings.js";
import { messages } from "./client/messages.js";
import { sessionDataRpc, workspaceChanges } from "./shared/contracts.js";
import { artifactTypes, type ArtifactType } from "./shared/artifacts.js";
import { browserChanges, defaultArtifactBrowser, type ArtifactBrowser as BrowserPreference } from "./shared/browserSettings.js";

const artifactIcons = { document: "FileText", artboard: "LayoutGrid", html: "Code", slides: "Presentation", whiteboard: "Pencil", verify: "ClipboardCheck", report: "ChartNoAxesCombined", storyboard: "Clapperboard" };

export default function contribute(client: PluginClientContext) {
  let nextRequestId = 0;
  let pendingOpen: { id: string; url: string; workspaceId: string } | undefined;

  // Paseo exposes workspace browser navigation on screens and panels.
  function ArtifactBrowser({ params, navigation, theme, layout }: PluginScreenProps) {
    const { t } = useTranslation(messages);
    const [failedId, setFailedId] = useState<string>();
    const request = pendingOpen?.id === params.requestId ? pendingOpen : undefined;
    const openBrowser = navigation?.openBrowser;

    useEffect(() => {
      if (!openBrowser || !request || pendingOpen !== request) return;
      pendingOpen = undefined;
      try {
        openBrowser({ url: request.url, workspaceId: request.workspaceId });
      } catch {
        setFailedId(request.id);
      }
    }, [openBrowser, request]);

    const labelStyle = { color: theme.colors.foreground };
    if (failedId && failedId === params.requestId) {
      return <View style={{ padding: layout.compact ? 16 : 24 }}><Text style={labelStyle}>{t("browser.openFailed")}</Text></View>;
    }
    if (!request || openBrowser) return null;
    return (
      <View style={{ padding: layout.compact ? 16 : 24 }}>
        <ExternalLink href={request.url}><Text style={labelStyle}>{t("browser.openExternal")}</Text></ExternalLink>
      </View>
    );
  }

  const removeBrowserScreen = client.addScreen({ id: "artifact-browser", title: "Ryugi", Component: ArtifactBrowser });
  const removeRemoteSettings = client.addSettingsScreen({ id: "remote-access", title: messages.message("remote.title"), icon: "Globe", Component: RemoteAccessSettings });
  const removeDesignSettings = client.addSettingsScreen({ id: "design", title: messages.message("runtime.settings"), icon: "Palette", Component: DesignSettings });
  const removeBrowserSettings = client.addSettingsScreen({ id: "browser", title: messages.message("browser.openWith"), icon: "Globe", Component: BrowserSettings });
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
  let browser: BrowserPreference = defaultArtifactBrowser;
  const browserWatch = client.subscribe(browserChanges, {}, (event) => { browser = event.browser; }, { signal: lifetime.signal });
  void browserWatch.ready.catch((error) => { if (!lifetime.signal.aborted) console.error("[Ryugi] 浏览器设置同步失败", error); });
  const agents = new Map<string, { workspaceId: string; checking: boolean; pending: boolean; localProbe?: string; artifacts: Map<ArtifactType, { url: string; button?: PluginButtonRegistration<PluginText> }>; stopWatch?: () => void }>();
  const remove = (id: string) => { const state = agents.get(id); state?.stopWatch?.(); for (const entry of state?.artifacts.values() || []) entry.button?.remove(); agents.delete(id); };
  const check = async (id: string) => {
    const state = agents.get(id);
    if (!state || lifetime.signal.aborted) return;
    if (state.checking) { state.pending = true; return; }
    state.checking = true;
    try {
      const result = await client.rpc(sessionDataRpc, { agentId: id, workspaceId: state.workspaceId });
      if (lifetime.signal.aborted || agents.get(id) !== state) return;
      state.localProbe = result.localProbe;
      for (const kind of artifactTypes) {
        const artifact = result.artifacts.find((x) => x.artifact.startsWith(`${kind}/`));
        const entry = state.artifacts.get(kind);
        if (!artifact) { entry?.button?.remove(); state.artifacts.delete(kind); }
        else if (entry) entry.url = artifact.url;
        else {
          const next = { url: artifact.url, button: undefined as PluginButtonRegistration<PluginText> | undefined };
          next.button = client.addComposerPill({
            id: `ryugi-${kind}`, workspaceId: state.workspaceId, agentId: id,
            button: {
              title: messages.message(kind),
              icon: artifactIcons[kind],
              behavior: {
                kind: "action",
                async onPress() {
                  const localUrl = next.url;
                  const url = !state.localProbe || await canOpenLocally(state.localProbe)
                    ? localUrl
                    : (await client.rpc(remoteArtifactRpc, { url: localUrl })).url;
                  if (lifetime.signal.aborted || agents.get(id) !== state) return;
                  if (browser === "system") return openExternalUrl(url);
                  const requestId = String(++nextRequestId);
                  pendingOpen = { id: requestId, url, workspaceId: state.workspaceId };
                  client.openScreen({ screenId: "artifact-browser", params: { requestId } });
                },
              },
            },
          });
          state.artifacts.set(kind, next);
        }
      }
    } catch (error) { console.error("[Ryugi] 会话同步失败", error); }
    finally { state.checking = false; if (state.pending) { state.pending = false; void check(id); } }
  };
  const register = (agent: { id: string; workspaceId?: string | null }) => {
    if (!agent.workspaceId) { remove(agent.id); return; }
    const old = agents.get(agent.id);
    if (!old || old.workspaceId !== agent.workspaceId) {
      remove(agent.id);
      const state = { workspaceId: agent.workspaceId, checking: false, pending: false, artifacts: new Map(), stopWatch: undefined as (() => void) | undefined };
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
  return () => { lifetime.abort(); clearInterval(timer); for (const id of agents.keys()) remove(id); removeTransformer(); removeRenderer(); removeBrowserScreen(); removeBrowserSettings(); removeDesignSettings(); removeRemoteSettings(); };
}
