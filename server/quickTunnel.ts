import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { URL } from "node:url";
import type { AddressInfo } from "node:net";
import { startArtifactProxy } from "./artifactProxy.js";

export function createLocalProbe() {
  const token = randomBytes(24).toString("hex");
  const server = createServer((req, res) => {
    if (req.url !== `/${token}` || req.headers.host !== `127.0.0.1:${(server.address() as AddressInfo).port}`) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") res.writeHead(204).end();
    else if (req.method === "GET") res.end(token);
    else res.writeHead(405).end();
  });
  let url: Promise<string> | undefined;
  let closed = false;
  return {
    url() {
      if (closed) throw new Error("Ryugi plugin is closed");
      return url ??= (async () => {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        server.unref();
        return `http://127.0.0.1:${(server.address() as AddressInfo).port}/${token}`;
      })();
    },
    close() {
      closed = true;
      // Listening may still be pending when the plugin unloads.
      void url?.then(() => server.close(), () => {});
    },
  };
}

const tunnelUrl = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/;

export function createQuickTunnel(binary: string) {
  type Tunnel = { password: string; ready: Promise<string>; stop(): void };
  const tunnels = new Map<string, Tunnel>();
  const listeners = new Set<(active: boolean) => void>();

  function notify(active: boolean) {
    for (const listener of listeners) listener(active);
  }

  function stop() {
    if (!tunnels.size) return false;
    const running = [...tunnels.values()];
    tunnels.clear();
    for (const tunnel of running) tunnel.stop();
    notify(false);
    return true;
  }

  async function open(localUrl: string, password: string) {
    const local = new URL(localUrl);
    if (local.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(local.hostname)
      || !local.port || local.username || local.password) throw new Error("Invalid local Ryugi URL");
    const port = local.port;
    let current = tunnels.get(port);
    if (!current || current.password !== password) {
      const controller = new AbortController();
      const target = new URL(`http://localhost:${port}`);
      const started: Tunnel = {
        password,
        ready: startTunnel(binary, target, controller, password),
        stop: () => controller.abort(),
      };
      controller.signal.addEventListener("abort", () => {
        if (tunnels.get(port) !== started) return;
        tunnels.delete(port);
        if (!tunnels.size) notify(false);
      }, { once: true });
      void started.ready.catch(() => started.stop());
      const first = tunnels.size === 0;
      tunnels.set(port, started);
      current?.stop();
      if (first) notify(true);
      current = started;
    }
    const origin = await current.ready;
    if (tunnels.get(port) !== current) throw new Error("Ryugi tunnel connection changed. Try opening the artifact again.");
    return origin + local.pathname + local.search + local.hash;
  }

  return {
    open,
    stop,
    subscribe(listener: (active: boolean) => void) {
      listeners.add(listener);
      listener(tunnels.size > 0);
      return () => { listeners.delete(listener); };
    },
  };
}

async function startTunnel(binary: string, target: URL, controller: AbortController, password: string): Promise<string> {
  const { signal } = controller;
  let origin: string | undefined;
  const proxy = await startArtifactProxy(target, () => origin, password);
  if (signal.aborted) { proxy.close(); throw new Error("Ryugi tunnel stopped"); }
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      "tunnel", "--no-autoupdate", "--protocol", "http2",
      "--url", proxy.url, "--http-host-header", target.host,
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("TUNNEL_"))) });

    const close = (error: Error, terminate: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      proxy.close();
      if (terminate) child.kill();
      reject(error);
      controller.abort();
    };
    const onAbort = () => close(new Error("Ryugi tunnel stopped"), true);
    const timer = setTimeout(() => close(new Error("Ryugi tunnel timed out while connecting to Cloudflare"), true), 20_000);
    signal.addEventListener("abort", onAbort, { once: true });
    let log = "";
    let registered = false;
    const read = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-4096);
      origin ??= tunnelUrl.exec(log)?.[0];
      registered ||= log.includes("Registered tunnel connection");
      if (origin && registered) {
        clearTimeout(timer);
        resolve(origin);
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("error", (error: NodeJS.ErrnoException) => {
      const message = error.code === "ENOENT"
        ? "Bundled cloudflared is missing. Run npm run setup:runtime on the Paseo host."
        : `Could not start bundled cloudflared: ${error.message}`;
      close(new Error(message), false);
    });
    child.once("exit", (code, reason) => {
      close(new Error(`cloudflared exited (${code ?? reason})`), false);
    });
  });
}
