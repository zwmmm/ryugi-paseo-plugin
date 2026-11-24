import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { getRealDataRpc, addRealCommentRpc, initSessionSingletonRpc } from "../shared/contracts.js";

export function ArtboardPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const paseo = usePaseo();
  const getRealData = useRpc(getRealDataRpc);
  const addRealComment = useRpc(addRealCommentRpc);
  const initSingleton = useRpc(initSessionSingletonRpc);

  const [data, setData] = useState<Awaited<ReturnType<typeof getRealData>> | null>(null);
  const [selectedArtArtifact, setSelectedArtArtifact] = useState<string | undefined>();
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [feedbackText, setFeedbackText] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const refresh = React.useCallback(async (artArt?: string) => {
    try {
      const res = await getRealData({
        agentId,
        artboardArtifact: artArt || selectedArtArtifact,
      });
      setData(res);
      if (!selectedArtArtifact) {
        setSelectedArtArtifact(res.currentArtboard.artifact);
      }
      if (res.currentArtboard.boards.length > 0 && !selectedBoardId) {
        setSelectedBoardId(res.currentArtboard.boards[0].id);
      }
    } catch (e: any) {
      setStatusMsg("加载画板失败: " + e.message);
    }
  }, [getRealData, agentId, selectedArtArtifact, selectedBoardId]);

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
      topBar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginBottom: 12,
        flexWrap: "wrap" as const,
        gap: 8,
      },
      selectorRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        flexWrap: "wrap" as const,
      },
      chip: {
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
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
      btnSingleton: {
        backgroundColor: theme.colors.surface2,
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.accent,
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
      headerTitle: {
        fontSize: layout.compact ? 15 : 17,
        fontWeight: "bold" as const,
        color: theme.colors.foreground,
        marginBottom: 4,
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

  const handleInitSingleton = async () => {
    setStatusMsg("正在为此会话锁定唯一的专属原型画板...");
    const res = await initSingleton({ agentId });
    setSelectedArtArtifact(res.artboardArtifact);
    await refresh(res.artboardArtifact);
    setStatusMsg(`✓ 已锁定会话专属画板: ${res.artboardArtifact}`);
  };

  const handleUpdateStatus = async (verdict: "PASS" | "REJECT") => {
    if (!currentArtboard || !activeBoard) return;
    setStatusMsg(`正在将方案 [${activeBoard.name}] 判定为 ${verdict}...`);
    const commentText = `[${verdict}] 评审意见: ${feedbackText.trim() || "符合设计规范，允许合入"}`;
    await addRealComment({
      artifact: currentArtboard.artifact,
      blockId: activeBoard.id,
      text: commentText,
    });
    setFeedbackText("");
    setStatusMsg(`✓ 方案 [${activeBoard.name}] 已判定为 ${verdict}！`);
    await refresh();
  };

  const handleSendToAgent = async () => {
    if (!activeBoard || !currentArtboard) return;
    try {
      const textPayload = `【Ryugi 画板方案审阅】\n目标画板 [${currentArtboard.artifact}] 方案 [${activeBoard.name}]：\n- 方案标识: #${activeBoard.id}\n- 渲染规格: ${activeBoard.width}x${activeBoard.height} (${activeBoard.file})\n- 评审要求: ${feedbackText.trim() || "请根据此方案布局推进开发"}`;
      await paseo.agents.ref(agentId).send(textPayload);
      setStatusMsg(`已直接推送到当前 Agent 对话！`);
    } catch (e: any) {
      setStatusMsg("发送提示: " + e.message);
    }
  };

  return (
    <View style={styles.container}>
      {/* 顶部工具栏：选择画板工件或锁定单例 */}
      <View style={styles.topBar}>
        <View style={styles.selectorRow}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>画板工件:</Text>
          {data?.availableArtboards.length === 0 ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
              当前项目无画板工件
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
        </View>

        <Pressable style={styles.btnSingleton} onPress={handleInitSingleton}>
          <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "bold" }}>
            + 锁定会话专属画板
          </Text>
        </Pressable>
      </View>

      <View style={styles.contentRow}>
        {/* 画板方案卡片对比 */}
        <View style={styles.canvasArea}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 12 }}>
            工件: {currentArtboard?.artifact} | 渲染: {currentArtboard?.webUrl}
          </Text>
          <ScrollView>
            {currentArtboard?.boards.length === 0 ? (
              <View style={{ padding: 20, alignItems: "center" as const }}>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, marginBottom: 12 }}>
                  当前画板暂无 boards 方案卡片。
                </Text>
                <Pressable style={styles.btnSingleton} onPress={handleInitSingleton}>
                  <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "bold" }}>
                    点此初始化标准原型画板
                  </Text>
                </Pressable>
              </View>
            ) : (
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
                        <Text style={styles.cardFile}>文件: {b.file}</Text>
                      </View>
                      <Text style={styles.cardDim}>
                        {b.width} × {b.height} px
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>

        {/* 方案审查栏 */}
        <View style={styles.sidebarArea}>
          <Text style={styles.headerTitle}>
            方案审阅 · {activeBoard ? activeBoard.name : "请在画板点选"}
          </Text>
          {activeBoard ? (
            <View style={{ marginTop: 10 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 6 }}>
                标识: #{activeBoard.id} | 规格: {activeBoard.width}x{activeBoard.height}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="填写方案的确认或修改建议..."
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
              在左侧点选任意设计方案，即可执行 Pass / Reject 或向 Agent 发送修改建议。
            </Text>
          )}

          {statusMsg && <Text style={styles.statusText}>{statusMsg}</Text>}
        </View>
      </View>
    </View>
  );
}
