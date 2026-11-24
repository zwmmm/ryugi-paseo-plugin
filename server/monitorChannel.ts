import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export type MonitorBinding = { project: string; artifact: string };
export type MonitorEvent = MonitorBinding & {
  type: "ryugi-comments" | "ryugi-choices" | "ryugi-answers";
  [key: string]: unknown;
};
type Subscription = MonitorBinding & { host: "paseo"; session: string };
type Options = {
  agentId: string;
  bindings: readonly MonitorBinding[];
  onEvent: (event: MonitorEvent, id: unknown) => Promise<void>;
  onError?: (error: Error) => void;
  socketPath?: string;
  serverHome?: string;
  retryMs?: number;
  subscribe?: (subscription: Subscription) => Promise<void>;
};

export function monitorSocketPath(serverHome = process.env.RYUGI_SERVER_HOME || path.join(os.homedir(), ".ryugi/server")) {
  if (process.env.RYUGI_HUB_SOCKET) return process.env.RYUGI_HUB_SOCKET;
  const home = path.resolve(serverHome);
  const own = home === path.join(os.homedir(), ".ryugi/server")
    ? ""
    : `-${createHash("sha256").update(home).digest("hex").slice(0, 12)}`;
  return path.join(process.env.RYUGI_RUNTIME_DIR || `/tmp/ryugi-${process.getuid?.() ?? 0}`, `hub${own}.sock`);
}

export async function subscribeMonitor(serverHome: string, subscription: Subscription) {
  const info = JSON.parse(await fs.promises.readFile(path.join(serverHome, "server-info"), "utf8"));
  const url = new URL(info.url);
  const key = url.searchParams.get("key") || "";
  url.pathname = "/api/agent/subscribe";
  url.search = "";
  url.searchParams.set("key", key);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ryugi-Project": encodeURIComponent(subscription.project) },
      body: JSON.stringify(subscription),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ryugi subscription failed: ${response.status}`);
  } finally { clearTimeout(timeout); }
}

export function startMonitorChannel(options: Options) {
  const home = path.resolve(options.serverHome || process.env.RYUGI_SERVER_HOME || path.join(os.homedir(), ".ryugi/server"));
  const retryMs = options.retryMs ?? 1000;
  const subscribe = options.subscribe || ((subscription: Subscription) => subscribeMonitor(home, subscription));
  let bindings = [...options.bindings];
  let socket: net.Socket | undefined;
  let closed = false;
  let welcomed = false;
  let connectingFailures = 0;
  let deliveryFailures = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
  let subscriptionTimer: ReturnType<typeof setTimeout> | undefined;
  let processing = false;
  let subscribing = false;
  let subscriptionRevision = 0;
  const completed = new Set<string>();
  const subscribed = new Set<string>();
  const queue: Array<{ event: MonitorEvent; id: unknown; token: string }> = [];
  const report = (error: unknown) => options.onError?.(error instanceof Error ? error : new Error(String(error)));
  const bindingKey = (value: MonitorBinding) => JSON.stringify([value.project, value.artifact]);
  const matches = (value: MonitorBinding) => bindings.some((binding) => bindingKey(binding) === bindingKey(value));
  const send = (value: unknown) => {
    if (welcomed && socket && !socket.destroyed) socket.write(`${JSON.stringify(value)}\n`);
  };
  const backoff = (failures: number) => Math.min(retryMs * 2 ** Math.min(failures, 10), 30000);

  const syncSubscriptions = async () => {
    if (closed || !welcomed || subscribing) return;
    subscribing = true;
    const connection = socket;
    const revision = subscriptionRevision;
    try {
      for (const binding of bindings) {
        if (closed || !welcomed || connection !== socket) break;
        if (subscribed.has(bindingKey(binding))) continue;
        await subscribe({ ...binding, host: "paseo", session: options.agentId });
        if (connection === socket) subscribed.add(bindingKey(binding));
      }
    } catch (error) {
      report(error);
      if (!closed) subscriptionTimer = setTimeout(() => void syncSubscriptions(), retryMs);
    } finally {
      subscribing = false;
      if (!closed && welcomed && (connection !== socket || revision !== subscriptionRevision)) void syncSubscriptions();
    }
  };

  const drain = async () => {
    if (closed || processing || deliveryTimer || !queue.length) return;
    processing = true;
    const item = queue[0];
    try {
      await options.onEvent(item.event, item.id);
      completed.add(item.token);
      if (completed.size > 4096) completed.delete(completed.values().next().value!);
      const index = queue.indexOf(item);
      if (index >= 0) queue.splice(index, 1);
      if (!closed) send({ t: "delivered", id: item.id });
      deliveryFailures = 0;
    } catch (error) {
      report(error);
      if (!closed && queue.includes(item)) {
        deliveryTimer = setTimeout(() => {
          deliveryTimer = undefined;
          void drain();
        }, backoff(deliveryFailures++));
      }
    } finally {
      processing = false;
      if (!closed) void drain();
    }
  };

  const close = () => {
    closed = true;
    clearTimeout(reconnectTimer);
    clearTimeout(deliveryTimer);
    clearTimeout(subscriptionTimer);
    socket?.destroy();
    queue.length = 0;
  };
  const connect = () => {
    if (closed) return;
    const connection = net.createConnection(options.socketPath || monitorSocketPath(home));
    connection.setEncoding("utf8");
    connection.setTimeout(5000, () => connection.destroy(new Error("Ryugi monitor handshake timed out")));
    socket = connection;
    welcomed = false;
    subscribed.clear();
    let buffer = "";
    connection.on("connect", () => {
      let version = "";
      try { version = fs.readFileSync(path.join(home, "server-version"), "utf8").trim(); } catch {}
      connection.write(`${JSON.stringify({ t: "hello", protocol: 1, version, host: "paseo", session: options.agentId, agent: "Paseo" })}\n`);
    });
    connection.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 4 * 1024 * 1024) { connection.destroy(new Error("Ryugi monitor frame too large")); return; }
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (!message || typeof message !== "object") continue;
        if (message.t === "welcome") {
          connection.setTimeout(0);
          welcomed = true;
          connectingFailures = 0;
          void syncSubscriptions();
        } else if (message.t === "bye" && message.reason === "replaced") {
          close();
        } else if (message.t === "refuse") {
          connection.destroy();
        } else if (message.t === "retract") {
          for (let index = queue.length - 1; index >= 0; index--) {
            const event = queue[index].event;
            if (event.project === message.project && event.artifact === message.artifact && event.type === message.type) queue.splice(index, 1);
          }
        } else if (message.t === "event" && welcomed) {
          const event = message.event;
          if (!event || !["ryugi-comments", "ryugi-choices", "ryugi-answers"].includes(event.type)
            || typeof event.project !== "string" || !path.isAbsolute(event.project)
            || typeof event.artifact !== "string" || !/^(document|artboard|whiteboard|slides|storyboard|preview)\/[a-z0-9][a-z0-9-]*$/.test(event.artifact)
            || !matches(event) || message.id === undefined || message.id === null) continue;
          const token = JSON.stringify([message.id, event]);
          if (completed.has(token)) send({ t: "delivered", id: message.id });
          else if (!queue.some((item) => item.token === token)) {
            queue.push({ event, id: message.id, token });
            void drain();
          }
        }
      }
    });
    connection.on("error", report);
    connection.on("close", () => {
      if (socket !== connection) return;
      welcomed = false;
      if (!closed) reconnectTimer = setTimeout(connect, backoff(connectingFailures++));
    });
  };
  connect();
  return {
    close,
    updateBindings(next: readonly MonitorBinding[]) {
      bindings = [...next];
      subscriptionRevision++;
      for (let index = queue.length - 1; index >= 0; index--) if (!matches(queue[index].event)) queue.splice(index, 1);
      void syncSubscriptions();
    },
  };
}
