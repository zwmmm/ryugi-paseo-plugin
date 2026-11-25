import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useTranslation, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { z } from "zod";
import { messages } from "./messages.js";

export const monitorNoticeSchema = z.object({
  type: z.enum(["ryugi-comments", "ryugi-choices", "ryugi-answers"]),
  withdrawn: z.boolean(),
  count: z.number().int().positive().optional(),
  text: z.string(),
});

type Notice = z.output<typeof monitorNoticeSchema>;
type Translate = ReturnType<typeof useTranslation<typeof messages.resources.en>>["t"];

export function parseMonitorNotice(text: string): Notice | undefined {
  const lines = text.split("\n");
  const header = /^Ryugi monitor: (ryugi-comments|ryugi-choices|ryugi-answers)(?:（用户已撤回提交）)?$/.exec(lines[0]);
  if (!header) return;
  let event;
  try { event = JSON.parse(lines[2]); } catch { return; }
  if (!event || event.type !== header[1] || typeof event.project !== "string" || typeof event.artifact !== "string") return;
  const count = event.type === "ryugi-answers" ? event.questions : event.unread;
  return {
    type: header[1] as Notice["type"],
    withdrawn: event.withdrawn === true,
    ...(Number.isSafeInteger(count) && count > 0 ? { count } : {}),
    text,
  };
}

export function noticeSummary(notice: Notice, t: Translate) {
  if (notice.type === "ryugi-choices") return t(notice.withdrawn ? "notice.choicesWithdrawn" : "notice.choices");
  if (notice.type === "ryugi-answers" && notice.withdrawn) return t("notice.answersWithdrawn");
  const key = notice.type === "ryugi-answers" ? "notice.answers" : "notice.comments";
  return notice.count ? t(`${key}Count`, { count: notice.count }) : t(key);
}

export function MonitorNotice({ item, theme }: PluginTimelineItemProps<z.output<typeof monitorNoticeSchema>>) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { t } = useTranslation(messages);
  const summary = noticeSummary(item.data, t);
  const active = hovered || expanded;
  const color = active ? theme.colors.foreground : theme.colors.foregroundMuted;
  return (
    <View style={styles.container} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <View style={[styles.header, { borderRadius: expanded ? 9999 : 8, backgroundColor: expanded ? theme.colors.surface1 : "transparent" }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={summary} accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.9 : 1 }]}>
          <View style={styles.icon}>
            <View style={active ? { marginLeft: -4, transform: [{ scale: 1.3 }, { rotate: expanded ? "90deg" : "0deg" }] } : { marginLeft: -1 }}>
              <Icon name={active ? "ChevronRight" : "Wrench"} size={12} color={color} />
            </View>
          </View>
          <Text numberOfLines={1} style={[styles.label, { color }]}>{summary}</Text>
        </Pressable>
      </View>
      {expanded && (
        <ScrollView style={styles.details} contentContainerStyle={styles.content} nestedScrollEnabled showsVerticalScrollIndicator>
          <View style={[styles.rail, { borderLeftColor: theme.colors.border }]}>
            <Text selectable style={[styles.text, { color: theme.colors.foregroundMuted }]}>{item.data.text}</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginHorizontal: -13, marginBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "transparent", overflow: "hidden" },
  button: { flex: 1, minWidth: 0, paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center" },
  icon: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginRight: 4 },
  label: { flex: 1, fontSize: 14, fontWeight: "normal" },
  details: { maxHeight: 400 },
  content: { paddingTop: 4, paddingHorizontal: 13 },
  rail: { marginLeft: 1, paddingLeft: 19, borderLeftWidth: 1 },
  text: { fontSize: 14 },
});
