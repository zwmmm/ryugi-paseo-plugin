import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { z } from "zod";

export const monitorNoticeSchema = z.object({ summary: z.string(), text: z.string() });

export function parseMonitorNotice(text: string) {
  const lines = text.split("\n");
  const header = /^Ryugi monitor: (ryugi-comments|ryugi-choices|ryugi-answers)(?:（用户已撤回提交）)?$/.exec(lines[0]);
  if (!header) return;
  let event;
  try { event = JSON.parse(lines[2]); } catch { return; }
  if (!event || event.type !== header[1] || typeof event.project !== "string" || typeof event.artifact !== "string") return;
  let summary: string;
  if (event.type === "ryugi-answers") {
    const count = Number.isSafeInteger(event.questions) && event.questions > 0 ? ` ${event.questions} 个问题的` : "";
    summary = event.withdrawn ? "已撤回回答" : `已提交${count}回答`;
  } else if (event.type === "ryugi-choices") {
    summary = event.withdrawn ? "已撤回方案选择" : "已提交方案选择";
  } else {
    const count = Number.isSafeInteger(event.unread) && event.unread > 0 ? ` ${event.unread} 条` : "";
    summary = `收到${count}新评论`;
  }
  return { summary: `Ryugi · ${summary}`, text };
}

export function MonitorNotice({ item, theme }: PluginTimelineItemProps<z.output<typeof monitorNoticeSchema>>) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const active = hovered || expanded;
  const color = active ? theme.colors.foreground : theme.colors.foregroundMuted;
  return (
    <View style={{ marginHorizontal: -13, marginBottom: 4 }} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <View style={{ flexDirection: "row", alignItems: "center", borderRadius: expanded ? 9999 : 8, borderWidth: 1, borderColor: "transparent", overflow: "hidden", backgroundColor: expanded ? theme.colors.surface1 : "transparent", opacity: pressed ? 0.9 : 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={item.data.summary} accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} style={{ flex: 1, minWidth: 0, paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginRight: 4 }}>
            <View style={active ? { marginLeft: -4, transform: [{ scale: 1.3 }, { rotate: expanded ? "90deg" : "0deg" }] } : { marginLeft: -1 }}>
              <Icon name={active ? "ChevronRight" : "Wrench"} size={12} color={color} />
            </View>
          </View>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", overflow: "hidden" }}>
            <Text numberOfLines={1} style={{ color, fontSize: 14, fontWeight: "normal", flexShrink: 0 }}>{item.data.summary}</Text>
          </View>
        </Pressable>
      </View>
      {expanded && (
        <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 13 }} nestedScrollEnabled showsVerticalScrollIndicator>
          <View style={{ marginLeft: 1, paddingLeft: 19, borderLeftWidth: 1, borderLeftColor: theme.colors.border }}>
            <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>{item.data.text}</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
