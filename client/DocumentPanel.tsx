import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { getRealDataRpc, addRealCommentRpc, initSessionSingletonRpc } from "../shared/contracts.js";

export function DocumentPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const paseo = usePaseo();
  const getRealData = useRpc(getRealDataRpc);
  const addRealComment = useRpc(addRealCommentRpc);
  const initSingleton = useRpc(initSessionSingletonRpc);

  const [data, setData] = useState<Awaited<ReturnType<typeof getRealData>> | null>(null);
  const [selectedDocArtifact, setSelectedDocArtifact] = useState<string | undefined>();
  const [selectedBlockId, setSelectedBlockId] = useState<string>("");
  const [newCommentText, setNewCommentText] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadData = React.useCallback(async (docArt?: string) => {
    try {
      const res = await getRealData({
        agentId,
        docArtifact: docArt || selectedDocArtifact,
      });
      setData(res);
      if (!selectedDocArtifact) {
        setSelectedDocArtifact(res.currentDoc.artifact);
      }
      if (res.currentDoc.blocks.length > 0 && !selectedBlockId) {
        setSelectedBlockId(res.currentDoc.blocks[0].id);
      }
    } catch (e: any) {
      setStatusMsg("加载失败: " + e.message);
    }
  }, [getRealData, agentId, selectedDocArtifact, selectedBlockId]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const doc = data?.currentDoc;
  const blockComments = useMemo(() => {
    if (!doc) return [];
    return doc.comments.filter((c) => c.blockId === selectedBlockId);
  }, [doc, selectedBlockId]);

  const selectedBlock = useMemo(() => {
    return doc?.blocks.find((b) => b.id === selectedBlockId);
  }, [doc, selectedBlockId]);

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
      docCol: {
        flex: layout.compact ? undefined : 3,
        height: layout.compact ? 320 : ("100%" as const),
        backgroundColor: theme.colors.surface1,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: 14,
      },
      commentCol: {
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
      metaText: {
        fontSize: 12,
        color: theme.colors.foregroundMuted,
        marginBottom: 10,
      },
      blockItem: {
        padding: 10,
        borderRadius: 6,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: "transparent",
      },
      blockSelected: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.surface2,
      },
      blockLine: {
        fontSize: 11,
        color: theme.colors.accent,
        fontWeight: "600" as const,
        marginBottom: 2,
      },
      blockText: {
        fontSize: 13,
        color: theme.colors.foreground,
        lineHeight: 18,
      },
      commentItem: {
        backgroundColor: theme.colors.surface0,
        padding: 10,
        borderRadius: 6,
        marginBottom: 10,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.accent,
      },
      commentAuthor: {
        fontSize: 12,
        fontWeight: "bold" as const,
        color: theme.colors.foreground,
        marginBottom: 4,
      },
      commentText: {
        fontSize: 13,
        color: theme.colors.foreground,
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
      btnRow: {
        flexDirection: "row" as const,
        gap: 8,
      },
      btnPrimary: {
        backgroundColor: theme.colors.accent,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 6,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      btnSecondary: {
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 6,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      btnText: {
        color: theme.colors.foreground,
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
    setStatusMsg("正在为此会话锁定唯一的专属 PRD 文档...");
    const res = await initSingleton({ agentId });
    setSelectedDocArtifact(res.docArtifact);
    await loadData(res.docArtifact);
    setStatusMsg(`✓ 已锁定会话单例: ${res.docArtifact}`);
  };

  const handleAddComment = async () => {
    if (!newCommentText.trim() || !doc || !selectedBlock) return;
    setStatusMsg("正在向 Ryugi 写入批注...");
    const res = await addRealComment({
      artifact: doc.artifact,
      blockId: selectedBlock.id,
      text: newCommentText.trim(),
    });

    if (res.success) {
      setNewCommentText("");
      setStatusMsg("✓ 批注已保存！可在 Agent 输入框通过 @ 实时引用");
      await loadData();
    } else {
      setStatusMsg("写入失败: " + res.error);
    }
  };

  const handleSendDirectToAgent = async () => {
    if (!doc || !selectedBlock) return;
    try {
      const textPayload = `【Ryugi 批注指引】\n针对工件 [${doc.artifact}] 锚点 #${selectedBlock.id}：\n> "${selectedBlock.text}"\n\n修改意见：${newCommentText.trim() || "请根据规范修改此处的实现"}`;
      await paseo.agents.ref(agentId).send(textPayload);
      setStatusMsg(`已直接推送到当前 Agent 对话！`);
    } catch (e: any) {
      setStatusMsg("发送提示: " + e.message);
    }
  };

  return (
    <View style={styles.container}>
      {/* 顶部工具栏：选择已有工件或切换到单例工件 */}
      <View style={styles.topBar}>
        <View style={styles.selectorRow}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>文档工件:</Text>
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
        </View>

        <Pressable style={styles.btnSingleton} onPress={handleInitSingleton}>
          <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "bold" }}>
            + 锁定会话专属单例
          </Text>
        </Pressable>
      </View>

      <View style={styles.contentRow}>
        {/* 左侧：文档内容展示 */}
        <View style={styles.docCol}>
          <Text style={styles.headerTitle}>{doc?.artifact ?? "加载中..."}</Text>
          <Text style={styles.metaText}>
            项目目录: {data?.projectDir}
          </Text>
          <ScrollView style={{ flex: 1 }}>
            {doc?.blocks.length === 0 ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, padding: 12 }}>
                该文档暂无解析出的段落区块，点击上方“+ 锁定会话专属单例”快速生成标准模版。
              </Text>
            ) : (
              doc?.blocks.map((b) => {
                const isSelected = b.id === selectedBlockId;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setSelectedBlockId(b.id)}
                    style={[styles.blockItem, isSelected && styles.blockSelected]}
                  >
                    <Text style={styles.blockLine}>#{b.id} · &lt;{b.tag}&gt;</Text>
                    <Text style={styles.blockText}>{b.text}</Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>

        {/* 右侧：批注栏 */}
        <View style={styles.commentCol}>
          <Text style={styles.headerTitle}>
            批注反馈 · #{selectedBlock ? selectedBlock.id : "请选择段落"}
          </Text>
          <Text style={styles.metaText}>
            {blockComments.length} 条关于该段落的批注
          </Text>

          <ScrollView style={{ flex: 1, marginBottom: 12 }}>
            {blockComments.length === 0 ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, padding: 8 }}>
                该段落暂无批注。在下方输入修改意见并保存。
              </Text>
            ) : (
              blockComments.map((c) => (
                <View key={c.id} style={styles.commentItem}>
                  <Text style={styles.commentAuthor}>👤 {c.author}</Text>
                  <Text style={styles.commentText}>{c.text}</Text>
                </View>
              ))
            )}
          </ScrollView>

          <TextInput
            style={styles.input}
            placeholder="填写修改建议或提问..."
            placeholderTextColor={theme.colors.foregroundMuted}
            multiline
            value={newCommentText}
            onChangeText={setNewCommentText}
          />

          <View style={styles.btnRow}>
            <Pressable style={styles.btnPrimary} onPress={handleAddComment}>
              <Text style={styles.btnText}>保存至 Ryugi</Text>
            </Pressable>
            <Pressable style={styles.btnSecondary} onPress={handleSendDirectToAgent}>
              <Text style={styles.btnText}>直送 Agent</Text>
            </Pressable>
          </View>

          {statusMsg && <Text style={styles.statusText}>{statusMsg}</Text>}
        </View>
      </View>
    </View>
  );
}
