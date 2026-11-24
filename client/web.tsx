import React, { useEffect } from "react";
import { Platform, View, Text } from "react-native";

// DOM declarations for client/web.ts (audited Paseo web boundary)
declare const window: any;

export interface WebFrameViewProps {
  url: string;
  title?: string;
  onMessage?: (data: any) => void;
  style?: any;
}

/**
 * Web iframe container strictly gated by Platform.OS === 'web'.
 * On mobile/native, renders a clean fallback.
 */
export function WebFrameView({ url, title, onMessage, style }: WebFrameViewProps) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    useEffect(() => {
      if (!onMessage) return;
      const handleMessage = (event: any) => {
        try {
          if (event && event.data) {
            onMessage(event.data);
          }
        } catch {
          // ignore parsing error from third-party events
        }
      };
      window.addEventListener("message", handleMessage);
      return () => {
        window.removeEventListener("message", handleMessage);
      };
    }, [onMessage]);

    return (
      <iframe
        src={url}
        title={title || "Ryugi Web Workspace"}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          backgroundColor: "transparent",
          display: "block",
          flex: 1,
          ...style,
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
      <Text style={{ color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
        Ryugi 交互式 Web 画板及文档组件在桌面环境 (Electron / Web) 原生渲染。
      </Text>
    </View>
  );
}

/**
 * Opens a URL in the browser on Web platform.
 */
export function openExternalBrowser(url: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.open) {
    window.open(url, "_blank");
  }
}
