import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { getRealDataRpc, addRealCommentRpc } from "../shared/contracts.js";

export function DocumentPanel({ theme, layout }: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const getRealData = useRpc(getRealDataRpc);
  const addRealComment = useRpc(addRealCommentRpc);

  const [data, setData] = useState<Awaited<ReturnType<typeof getRealData>> | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string>("intro");
  const [newCommentText, setNewCommentText] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    try {
      const res = await getRealData({});
      setData(res);
    } catch (e: any) {
      setStatusMsg("加载失败: " + e.message);
    }
  }, [getRealData]);

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
        fontSize: layout.compact ? 16 : 18,
        fontWeight: "bold" as const,
        color: theme.colors.foreground,
        marginBottom: 4,
      },
      metaText: {
        fontSize: 12,
        color: theme.colors.foregroundMuted,
        marginBottom: 12,
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
        fontSize: 14,
        color: theme.colors.foreground,
        lineHeight: 20,
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

  const handleAddComment = async () => {
    if (!newCommentText.trim() || !doc || !selectedBlock) return;
    setStatusMsg("正在向 Ryugi 核心引擎写入批注...");
    const res = await addRealComment({
      artifact: doc.artifact,
      blockId: selectedBlock.id,
      text: newCommentText.trim(),
    });

    if (res.success) {
      setNewCommentText("");
      setStatusMsg("✓ 真实批注已存入 .ryugi/ 存储！可在 Agent 对话框通过 @ 实时引用");
      await loadData();
    } else {
      setStatusMsg("批注写入失败: " + res.error);
    }
  };

  const handleSendDirectToAgent = async () => {
    if (!doc || !selectedBlock) return;
    try {
      const agents = await paseo.agents.list();
      const firstEntry = agents.entries[0];
      if (firstEntry?.agent?.id) {
        const textPayload = `【Ryugi 批注指引】\n针对工件 [${doc.artifact}] 锚点块 #${selectedBlock.id}：\n> "${selectedBlock.text}"\n\n评审修改意见：${newCommentText.trim() || "请根据规范修改此处的实现"}`;
        await paseo.agents.ref(firstEntry.agent.id).send(textPayload);
        setStatusMsg(`已直接推送到 Agent [${firstEntry.agent.id.slice(-6)}] 对话！`);
      } else {
        setStatusMsg("当前无活跃 Agent，可通过输入框附件(@)进行引用");
      }
    } catch (e: any) {
      setStatusMsg("发送提示: " + e.message);
    }
  };

  return (
    <View style={styles.container}>
      {/* 左侧：文档内容展示 */}
      <View style={styles.docCol}>
        <Text style={styles.headerTitle}>{doc?.artifact ?? "加载 Ryugi 真实文档中..."}</Text>
        <Text style={styles.metaText}>
          本地服务: {data?.serverUrl || "连接中..."} (点击段落高亮，查看已有批注)
        </Text>
        <ScrollView style={{ flex: 1 }}>
          {doc?.blocks.map((b) => {
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
          })}
        </ScrollView>
      </View>

      {/* 右侧：针对所选段落的批注栏 */}
      <View style={styles.commentCol}>
        <Text style={styles.headerTitle}>
          真实批注互动 · #{selectedBlock ? selectedBlock.id : "未选择"}
        </Text>
        <Text style={styles.metaText}>
          {blockComments.length} 条关于该段落的真实评论记录
        </Text>

        <ScrollView style={{ flex: 1, marginBottom: 12 }}>
          {blockComments.length === 0 ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, padding: 8 }}>
              该锚点暂无批注。在下方输入建议，将直接调用 ryugi comment 写入本地仓库。
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
          placeholder="针对选中文档输入修改建议或评论..."
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
  );
}
