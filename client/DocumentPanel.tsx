import React, { useState, useMemo, useCallback, useEffect } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { getRealDataRpc, initSessionSingletonRpc } from "../shared/contracts.js";
import { WebFrameView, openExternalBrowser } from "./web.js";

export function DocumentPanel({ theme, layout, agentId, workspaceId, navigation }: PluginAgentPanelProps) {
  const paseo = usePaseo();
  const getRealData = useRpc(getRealDataRpc);
  const initSingleton = useRpc(initSessionSingletonRpc);

  const [data, setData] = useState<Awaited<ReturnType<typeof getRealData>> | null>(null);
  const [selectedDocArtifact, setSelectedDocArtifact] = useState<string | undefined>();
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadData = useCallback(
    async (docArt?: string) => {
      try {
        const res = await getRealData({
          agentId,
          workspaceId,
          docArtifact: docArt || selectedDocArtifact,
        });
        setData(res);
        if (!selectedDocArtifact && res.currentDoc?.artifact) {
          setSelectedDocArtifact(res.currentDoc.artifact);
        }
      } catch (e: any) {
        setStatusMsg("加载失败: " + e.message);
      }
    },
    [getRealData, agentId, workspaceId, selectedDocArtifact]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const doc = data?.currentDoc;
  const embedUrl = doc?.embedUrl || doc?.webUrl || (data?.embedServerUrl ? `${data.embedServerUrl}/${selectedDocArtifact || "document/comment-demo"}` : "");
  const externalWebUrl = doc?.webUrl || (data?.serverUrl ? `${data.serverUrl}/${selectedDocArtifact || "document/comment-demo"}` : "");

  const handleInitSingleton = async () => {
    try {
      setStatusMsg("正在锁定会话专属 PRD 单例...");
      const res = await initSingleton({ agentId, workspaceId });
      setSelectedDocArtifact(res.docArtifact);
      await loadData(res.docArtifact);
      setStatusMsg(`✓ 已锁定单例: ${res.docArtifact}`);
    } catch (e: any) {
      setStatusMsg("初始化失败: " + e.message);
    }
  };

  const handleOpenBrowser = () => {
    const url = externalWebUrl || embedUrl;
    if (!url) return;
    if (navigation?.openBrowser) {
      navigation.openBrowser({ url, workspaceId });
    } else {
      openExternalBrowser(url);
    }
  };

  const handleSyncCommentsToAgent = async () => {
    if (!doc) return;
    const comments = doc.comments;
    if (!comments || comments.length === 0) {
      setStatusMsg("当前文档暂无批注，可在下方网页中选中文本进行批注");
      return;
    }

    try {
      setStatusMsg("正在同步批注到 Agent 对话...");
      const summary = comments
        .slice(-5)
        .map((c, i) => `${i + 1}. [锚点 ${c.blockId || "页面"}] ${c.author}: ${c.text}`)
        .join("\n");

      const payload = `【Ryugi PRD 批注同步】\n工件: [${doc.artifact}]\n最新批注列表:\n${summary}\n\n请结合上述批注意见调整产品设计和代码实现。`;
      await paseo.agents.ref(agentId).send(payload);
      setStatusMsg(`✓ 已将 ${Math.min(comments.length, 5)} 条最新批注同步至当前对话！`);
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
      {/* 顶部工具栏：工件切换与消息打通动作 */}
      <View style={styles.topBar}>
        <View style={styles.leftRow}>
          <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>文档:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {data?.availableDocs.map((art) => {
              const isSel = (selectedDocArtifact || doc?.artifact) === art;
              return (
                <Pressable
                  key={art}
                  onPress={() => {
                    setSelectedDocArtifact(art);
                    loadData(art);
                  }}
                  style={[styles.chip, isSel && styles.chipActive]}
                >
                  <Text style={isSel ? styles.chipTextActive : styles.chipText}>
                    {art.replace("document/", "")}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.btnAction} onPress={handleInitSingleton}>
            <Text style={styles.btnText}>+ 锁定单例</Text>
          </Pressable>

          <Pressable style={[styles.btnAction, styles.btnActionPrimary]} onPress={handleSyncCommentsToAgent}>
            <Text style={styles.btnTextPrimary}>💬 同步批注到对话</Text>
          </Pressable>

          <Pressable style={styles.btnAction} onPress={handleOpenBrowser}>
            <Text style={styles.btnText}>↗ 独立窗口</Text>
          </Pressable>

          <Pressable style={styles.btnAction} onPress={() => loadData()}>
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

      {/* 核心展示区：通过无 CSP 代理原生呈现真实 Ryugi Web 页面 */}
      <View style={styles.frameContainer}>
        {embedUrl ? (
          <WebFrameView
            url={embedUrl}
            title={`Ryugi PRD: ${doc?.artifact || "Document"}`}
            onMessage={(msg) => {
              if (msg?.type === "comment_added") {
                loadData();
              }
            }}
          />
        ) : (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              正在加载 Ryugi 文档服务...
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
