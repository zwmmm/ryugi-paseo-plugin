import React, { useState, useMemo, useCallback, useEffect } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { getRealDataRpc, initSessionSingletonRpc } from "../shared/contracts.js";
import { WebFrameView, openExternalBrowser } from "./web.js";

export function ArtboardPanel({ theme, layout, agentId, workspaceId, navigation }: PluginAgentPanelProps) {
  const paseo = usePaseo();
  const getRealData = useRpc(getRealDataRpc);
  const initSingleton = useRpc(initSessionSingletonRpc);

  const [data, setData] = useState<Awaited<ReturnType<typeof getRealData>> | null>(null);
  const [selectedArtArtifact, setSelectedArtArtifact] = useState<string | undefined>();
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const refresh = useCallback(
    async (artArt?: string) => {
      try {
        const res = await getRealData({
          agentId,
          artboardArtifact: artArt || selectedArtArtifact,
        });
        setData(res);
        if (!selectedArtArtifact && res.currentArtboard?.artifact) {
          setSelectedArtArtifact(res.currentArtboard.artifact);
        }
      } catch (e: any) {
        setStatusMsg("加载画板失败: " + e.message);
      }
    },
    [getRealData, agentId, selectedArtArtifact]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const currentArtboard = data?.currentArtboard;
  const webUrl =
    currentArtboard?.webUrl ||
    (data?.serverUrl
      ? `${data.serverUrl}/${selectedArtArtifact || "artboard/prototype-demo"}`
      : "");

  const handleInitSingleton = async () => {
    try {
      setStatusMsg("正在为此会话锁定唯一的专属原型画板...");
      const res = await initSingleton({ agentId });
      setSelectedArtArtifact(res.artboardArtifact);
      await refresh(res.artboardArtifact);
      setStatusMsg(`✓ 已锁定单例画板: ${res.artboardArtifact}`);
    } catch (e: any) {
      setStatusMsg("初始化画板单例失败: " + e.message);
    }
  };

  const handleOpenBrowser = () => {
    if (!webUrl) return;
    if (navigation?.openBrowser) {
      navigation.openBrowser({ url: webUrl, workspaceId });
    } else {
      openExternalBrowser(webUrl);
    }
  };

  const handleSyncReviewsToAgent = async () => {
    if (!currentArtboard) return;
    const boards = currentArtboard.boards || [];

    try {
      setStatusMsg("正在将画板方案信息同步至当前 Agent 对话...");
      const boardSummary =
        boards.length > 0
          ? boards
              .map((b) => `- 方案 [${b.name}]: ${b.width}×${b.height} (${b.file || b.id})`)
              .join("\n")
          : "- 当前画板已就绪，正在呈现主交互视图";

      const payload = `【Ryugi 原型画板审阅同步】\n目标工件: [${currentArtboard.artifact}]\n画板地址: ${webUrl}\n包含的设计方案卡片:\n${boardSummary}\n\n请确认当前视觉与交互布局，并开始后续组件代码实现。`;
      await paseo.agents.ref(agentId).send(payload);
      setStatusMsg("✓ 已将画板方案信息推送到当前 Agent 对话！");
    } catch (e: any) {
      setStatusMsg("同步提示: " + e.message);
    }
  };

  const styles = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      },
      topBar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        flexWrap: "wrap" as const,
        gap: 8,
      },
      leftRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        flexShrink: 1,
      },
      chipScroll: {
        maxWidth: layout.compact ? 200 : 400,
      },
      chip: {
        paddingVertical: 3,
        paddingHorizontal: 8,
        borderRadius: 12,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        marginRight: 6,
      },
      chipActive: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      chipText: {
        fontSize: 11,
        color: theme.colors.foreground,
      },
      chipTextActive: {
        color: theme.colors.accentForeground,
        fontWeight: "bold" as const,
      },
      actionRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      btnAction: {
        paddingVertical: 4,
        paddingHorizontal: 9,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      btnActionPrimary: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      btnText: {
        fontSize: 11,
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
      btnTextPrimary: {
        fontSize: 11,
        color: theme.colors.accentForeground,
        fontWeight: "bold" as const,
      },
      statusBanner: {
        backgroundColor: theme.colors.surface2,
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
      },
      statusText: {
        fontSize: 11,
        color: theme.colors.accent,
      },
      frameContainer: {
        flex: 1,
        width: "100%" as const,
        height: "100%" as const,
        backgroundColor: theme.colors.surface0,
      },
    }),
    [theme, layout.compact]
  );

  return (
    <View style={styles.container}>
      {/* 顶部工具栏：画板切换与快捷操作 */}
      <View style={styles.topBar}>
        <View style={styles.leftRow}>
          <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>画板:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {data?.availableArtboards.length === 0 ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, marginLeft: 4 }}>
                (无独立画板工件)
              </Text>
            ) : (
              data?.availableArtboards.map((art) => {
                const isSel = (selectedArtArtifact || currentArtboard?.artifact) === art;
                return (
                  <Pressable
                    key={art}
                    onPress={() => {
                      setSelectedArtArtifact(art);
                      refresh(art);
                    }}
                    style={[styles.chip, isSel && styles.chipActive]}
                  >
                    <Text style={isSel ? styles.chipTextActive : styles.chipText}>
                      {art.replace("artboard/", "")}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.btnAction} onPress={handleInitSingleton}>
            <Text style={styles.btnText}>+ 锁定单例</Text>
          </Pressable>

          <Pressable style={[styles.btnAction, styles.btnActionPrimary]} onPress={handleSyncReviewsToAgent}>
            <Text style={styles.btnTextPrimary}>🎨 同步画板到对话</Text>
          </Pressable>

          <Pressable style={styles.btnAction} onPress={handleOpenBrowser}>
            <Text style={styles.btnText}>↗ 独立窗口</Text>
          </Pressable>

          <Pressable style={styles.btnAction} onPress={() => refresh()}>
            <Text style={styles.btnText}>↻</Text>
          </Pressable>
        </View>
      </View>

      {/* 状态与通知条 */}
      {statusMsg && (
        <View style={styles.statusBanner}>
          <Text style={styles.statusText}>{statusMsg}</Text>
          <Pressable onPress={() => setStatusMsg(null)}>
            <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* 核心展示区：直接原生展示 Ryugi Artboard 画布 Web 页面 */}
      <View style={styles.frameContainer}>
        {webUrl ? (
          <WebFrameView
            url={webUrl}
            title={`Ryugi Artboard: ${currentArtboard?.artifact || "Artboard"}`}
            onMessage={(msg) => {
              if (msg?.type === "round_submitted" || msg?.type === "comment_added") {
                refresh();
              }
            }}
          />
        ) : (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              正在启动 Ryugi 画板服务...
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
