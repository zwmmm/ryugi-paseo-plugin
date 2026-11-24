import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { getRealDataRpc, addRealCommentRpc } from "../shared/contracts.js";

export function ArtboardPanel({ theme, layout }: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const getRealData = useRpc(getRealDataRpc);
  const addRealComment = useRpc(addRealCommentRpc);

  const [data, setData] = useState<Awaited<ReturnType<typeof getRealData>> | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("variant-a");
  const [feedbackText, setFeedbackText] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await getRealData({});
      setData(res);
    } catch (e: any) {
      setStatusMsg("加载画板失败: " + e.message);
    }
  }, [getRealData]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const currentArtboard = data?.currentArtboard;
  const activeBoard = useMemo(() => {
    return currentArtboard?.boards.find((b) => b.id === selectedBoardId);
  }, [currentArtboard, selectedBoardId]);

  const styles = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
        padding: layout.compact ? 12 : 18,
      },
      header: {
        marginBottom: 12,
      },
      title: {
        fontSize: layout.compact ? 16 : 18,
        fontWeight: "bold" as const,
        color: theme.colors.foreground,
      },
      subtitle: {
        fontSize: 12,
        color: theme.colors.foregroundMuted,
        marginTop: 2,
      },
      tabRow: {
        flexDirection: "row" as const,
        gap: 8,
        marginBottom: 12,
      },
      tabItem: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      tabItemActive: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      tabItemText: {
        fontSize: 12,
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
      contentRow: {
        flex: 1,
        flexDirection: (layout.compact ? "column" : "row") as "column" | "row",
        gap: 16,
      },
      canvasArea: {
        flex: layout.compact ? undefined : 3,
        height: layout.compact ? 280 : ("100%" as const),
        backgroundColor: theme.colors.surface1,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: 16,
      },
      sidebarArea: {
        flex: layout.compact ? undefined : 2,
        backgroundColor: theme.colors.surface1,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: 14,
      },
      cardWrapper: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 12,
      },
      elementCard: {
        padding: 14,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        minWidth: 160,
        minHeight: 110,
        justifyContent: "space-between" as const,
      },
      elementCardSelected: {
        borderColor: theme.colors.accent,
      },
      cardName: {
        fontSize: 13,
        fontWeight: "bold" as const,
        color: theme.colors.foreground,
      },
      cardFile: {
        fontSize: 11,
        color: theme.colors.foregroundMuted,
        marginTop: 4,
      },
      cardDim: {
        fontSize: 11,
        color: theme.colors.accent,
        fontWeight: "bold" as const,
        marginTop: 8,
      },
      input: {
        backgroundColor: theme.colors.surface0,
        color: theme.colors.foreground,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 6,
        padding: 8,
        fontSize: 13,
        minHeight: 60,
        marginBottom: 8,
      },
      actionRow: {
        flexDirection: "row" as const,
        gap: 8,
        marginTop: 8,
      },
      btnPass: {
        backgroundColor: theme.colors.statusSuccess,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
      },
      btnReject: {
        backgroundColor: theme.colors.statusDanger,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
      },
      btnAction: {
        backgroundColor: theme.colors.accent,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 6,
      },
      btnText: {
        color: theme.colors.accentForeground,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      statusText: {
        color: theme.colors.accent,
        fontSize: 12,
        marginTop: 6,
      },
    }),
    [theme, layout.compact]
  );

  const handleUpdateStatus = async (verdict: "PASS" | "REJECT") => {
    if (!currentArtboard || !activeBoard) return;
    setStatusMsg(`正在将方案 [${activeBoard.name}] 判定为 ${verdict}...`);
    // 写入真实评论
    const commentText = `[${verdict}] 评审意见: ${feedbackText.trim() || "符合设计规范，允许合入"}`;
    await addRealComment({
      artifact: currentArtboard.artifact,
      blockId: activeBoard.id,
      text: commentText,
    });
    setFeedbackText("");
    setStatusMsg(`✓ 方案 [${activeBoard.name}] 已判定为 ${verdict} 并记入 Ryugi 存储！可在输入框通过 @ 实时引用`);
    await refresh();
  };

  const handleSendToAgent = async () => {
    if (!activeBoard || !currentArtboard) return;
    try {
      const agents = await paseo.agents.list();
      const firstEntry = agents.entries[0];
      if (firstEntry?.agent?.id) {
        const textPayload = `【Ryugi 画板方案审阅】\n目标画板 [${currentArtboard.artifact}] 方案 [${activeBoard.name}]：\n- 方案标识: #${activeBoard.id}\n- 渲染文件: ${activeBoard.file} (${activeBoard.width}x${activeBoard.height})\n- 评审要求: ${feedbackText.trim() || "请根据此方案布局推进开发"}`;
        await paseo.agents.ref(firstEntry.agent.id).send(textPayload);
        setStatusMsg(`已直接推送到 Agent [${firstEntry.agent.id.slice(-6)}]！`);
      } else {
        setStatusMsg("当前无活跃 Agent，可通过输入框附件(@)进行引用");
      }
    } catch (e: any) {
      setStatusMsg("发送提示: " + e.message);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{currentArtboard?.artifact ?? "加载 Ryugi 真实画板..."}</Text>
        <Text style={styles.subtitle}>
          基于本地 canvas.json 多方案对比与渲染。可直接在面板中 Pass / Reject 或向 Agent 发送提示
        </Text>
      </View>

      <View style={styles.contentRow}>
        {/* 画板方案卡片对比 */}
        <View style={styles.canvasArea}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 12 }}>
            工件渲染地址: {currentArtboard?.webUrl || "正在生成..."}
          </Text>
          <ScrollView>
            <View style={styles.cardWrapper}>
              {currentArtboard?.boards.map((b) => {
                const isSel = selectedBoardId === b.id;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setSelectedBoardId(b.id)}
                    style={[styles.elementCard, isSel && styles.elementCardSelected]}
                  >
                    <View>
                      <Text style={styles.cardName}>{b.name}</Text>
                      <Text style={styles.cardFile}>渲染文件: {b.file}</Text>
                    </View>
                    <Text style={styles.cardDim}>
                      {b.width} × {b.height} px
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* 方案审查栏 */}
        <View style={styles.sidebarArea}>
          <Text style={styles.title}>
            方案审阅 · {activeBoard ? activeBoard.name : "请在画板点选"}
          </Text>
          {activeBoard ? (
            <View style={{ marginTop: 10 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 6 }}>
                方案标识: #{activeBoard.id} | 规格: {activeBoard.width}x{activeBoard.height}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="填写对该设计方案的修改或确认建议..."
                placeholderTextColor={theme.colors.foregroundMuted}
                multiline
                value={feedbackText}
                onChangeText={setFeedbackText}
              />
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.btnPass}
                  onPress={() => handleUpdateStatus("PASS")}
                >
                  <Text style={styles.btnText}>✓ 通过 (Pass)</Text>
                </Pressable>
                <Pressable
                  style={styles.btnReject}
                  onPress={() => handleUpdateStatus("REJECT")}
                >
                  <Text style={styles.btnText}>✕ 驳回 (Reject)</Text>
                </Pressable>
                <Pressable
                  style={styles.btnAction}
                  onPress={handleSendToAgent}
                >
                  <Text style={styles.btnText}>直送 Agent</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, marginTop: 12 }}>
              在左侧点选任意设计方案，即可执行 Pass / Reject 或直送 Agent。
            </Text>
          )}

          {statusMsg && <Text style={styles.statusText}>{statusMsg}</Text>}
        </View>
      </View>
    </View>
  );
}
