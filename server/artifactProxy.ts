import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { URL } from "node:url";
import { once } from "node:events";
import { json } from "node:stream/consumers";

const loginPath = "/__paseo_ryugi/login";
const sessionCookie = "__Host-ryugi-remote";
const digest = (value: string) => createHash("sha256").update(value).digest();

function promptForPassword(res: ServerResponse, next: string, wrong = false) {
  res.writeHead(401, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  }).end(`<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>访问 Ryugi 工件</title>
<style>
  :root { color-scheme: light dark; font: 16px system-ui; }
  main { max-width: 24rem; margin: 12vh auto; padding: 1rem; }
  form { display: grid; gap: .75rem; }
  input, button { font: inherit; padding: .6rem; }
</style>
<main>
  <h1>访问 Ryugi 工件</h1>
  <form method="post" action="${loginPath}?next=${encodeURIComponent(next)}">
    <label for="password">访问密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required>
    ${wrong ? '<p role="alert">密码错误，请重试。</p>' : ''}
    <button type="submit">打开工件</button>
  </form>
</main>
</html>`);
}

export async function startArtifactProxy(target: URL, publicOrigin: () => string | undefined, password: string) {
  const port = Number(target.port);
  const sockets = new Set<Socket>();
  if (!password) throw new Error("Ryugi remote access requires a password");
  const expectedPassword = digest(password);
  const session = `${sessionCookie}=${randomBytes(32).toString("base64url")}`;
  const authorized = (req: IncomingMessage) => req.headers.cookie?.split(/;\s*/).includes(session);

  async function signIn(req: IncomingMessage, res: ServerResponse, origin: string, next: string) {
    if (req.headers.origin !== origin || req.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const location = next.startsWith("/") && !next.startsWith("//") ? URL.parse(next, origin) : null;
    if (!location || location.origin !== origin || location.pathname === loginPath) {
      res.writeHead(400).end("Invalid return URL");
      return;
    }
    try {
      let body = "";
      req.setEncoding("utf8");
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) { res.writeHead(413).end(); return; }
      }
      const value = new URLSearchParams(body).get("password") ?? "";
      if (!timingSafeEqual(digest(value), expectedPassword)) { promptForPassword(res, next, true); return; }
      res.writeHead(303, {
        Location: location.href,
        "Cache-Control": "no-store",
        "Set-Cookie": `${session}; Path=/; Secure; HttpOnly; SameSite=None`,
      }).end();
    } catch {
      if (!res.headersSent) res.writeHead(400).end("Invalid request");
    }
  }

  function requestPath(req: IncomingMessage) {
    if (req.headers.host !== target.host || !req.url?.startsWith("/") || req.url.startsWith("//")) return;
    const path = URL.parse(req.url, target.origin);
    if (path?.origin === target.origin) return path;
  }

  function headersFor(req: IncomingMessage, path: URL, origin: string) {
    const headers: IncomingHttpHeaders = { ...req.headers, host: target.host };
    const readOnly = req.method === "GET" || req.method === "HEAD";
    if (headers.origin === origin) headers.origin = target.origin;
    else if (readOnly && path.pathname.startsWith("/c/") && headers.origin === "null") delete headers.origin;
    else if (headers.origin || (!readOnly && headers["sec-fetch-site"] === "cross-site")) return;

    if (headers.referer) {
      const referer = URL.parse(headers.referer);
      if (referer?.origin === origin) headers.referer = target.origin + referer.pathname + referer.search;
      else delete headers.referer;
    }
    if (headers.cookie) {
      const remaining = headers.cookie.split(/;\s*/).filter((pair) => !pair.startsWith(`${sessionCookie}=`)).join("; ");
      if (remaining) headers.cookie = remaining;
      else delete headers.cookie;
    }
    return headers;
  }

  const server = createServer((req, res) => {
    const path = requestPath(req);
    const origin = publicOrigin();
    if (!path || !origin) { res.writeHead(403).end("Forbidden"); return; }

    if (path.pathname === loginPath && req.method === "POST") {
      void signIn(req, res, origin, path.searchParams.get("next") ?? "/");
      return;
    }
    const upstreamHeaders = headersFor(req, path, origin);
    if (!upstreamHeaders) { res.writeHead(403).end("Forbidden"); return; }
    if (!authorized(req)) {
      if (req.method === "GET" && (path.pathname === "/" || req.headers.accept?.includes("text/html"))) {
        promptForPassword(res, path.pathname + path.search);
      } else {
        res.writeHead(401, { "Cache-Control": "no-store" }).end("Password required");
      }
      return;
    }
    const boardMetadata = req.method === "GET" && /^\/api\/artifacts\/artboard\/[\w-]+$/.test(path.pathname);
    if (boardMetadata) upstreamHeaders["accept-encoding"] = "identity";
    const upstream = request({ hostname: "127.0.0.1", port, path: req.url, method: req.method, headers: upstreamHeaders }, (response) => {
      const headers: IncomingHttpHeaders = { ...response.headers, "cache-control": "private, no-store" };
      const redirect = headers.location && URL.parse(headers.location);
      if (redirect && redirect.protocol === "http:" && redirect.port === target.port
        && ["localhost", "127.0.0.1"].includes(redirect.hostname)) {
        headers.location = origin + redirect.pathname + redirect.search + redirect.hash;
      }
      if (boardMetadata && response.statusCode === 200 && headers["content-type"]?.startsWith("application/json")) {
        void json(response).then((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid artboard metadata");
          const { boardPort, boardPath, ...metadata } = value as Record<string, unknown>;
          // The Quick Tunnel exposes the main Ryugi origin. Use its same-origin preview route.
          delete headers["content-length"];
          delete headers["transfer-encoding"];
          delete headers.etag;
          res.writeHead(200, headers).end(JSON.stringify(metadata));
        }).catch(() => res.writeHead(502, { "Cache-Control": "no-store" }).end("Ryugi preview metadata unavailable"));
        return;
      }
      res.writeHead(response.statusCode ?? 502, headers);
      response.pipe(res);
      response.on("error", () => res.destroy());
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("Ryugi unavailable");
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });

  server.on("upgrade", (req, socket, head) => {
    const path = requestPath(req);
    const origin = publicOrigin();
    const headers = path && origin && headersFor(req, path, origin);
    if (!headers) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    if (!authorized(req)) { socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return; }
    const upstream = connect(port, "127.0.0.1", () => {
      const lines = Object.entries(headers).flatMap(([key, value]) => value === undefined ? [] : [value].flat().map((item) => `${key}: ${item}`));
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close() {
      server.close();
      for (const socket of sockets) socket.destroy();
    },
  };
}
