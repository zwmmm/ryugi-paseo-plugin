const assert = require("node:assert/strict");
const { createServer, request: httpRequest } = require("node:http");
const { once } = require("node:events");
const test = require("node:test");
const { startArtifactProxy } = require("../server/artifactProxy.ts");

test("认证后转发整个 Ryugi 端口，包括未从会话打开的页面和跨工件请求", async (t) => {
  const contentBase = "/c/test-project/artboard/example/";
  const upstream = createServer((req, res) => {
    if (req.url === "/api/artifacts/artboard/example") {
      const metadata = JSON.stringify({ contentBase, boardPort: 27429, boardPath: "/c/artboard/stable-id/", title: "Artboard" });
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(metadata) }).end(metadata);
      return;
    }
    if (req.url === "/native-redirect") {
      res.writeHead(302, { Location: "http://" + req.headers.host + "/document/other-id?native=1" }).end();
      return;
    }
    if (req.url === contentBase + "pages/example.html") {
      res.end("<p>Board content</p>");
      return;
    }
    res.end(JSON.stringify({ url: req.url, method: req.method, host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie }));
  });
  upstream.on("upgrade", (_req, socket) => {
    socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => upstream.close());
  const target = new URL(`http://localhost:${upstream.address().port}`);
  const publicOrigin = "https://unit-test.trycloudflare.com";
  const password = "private + pass";
  const proxy = await startArtifactProxy(target, () => publicOrigin, password);
  t.after(() => proxy.close());
  let cookie;
  const request = (path, { origin = publicOrigin, body, accept } = {}) => new Promise((resolve, reject) => {
    const headers = { host: target.host, origin };
    if (cookie) headers.cookie = cookie;
    if (accept) headers.accept = accept;
    if (body) headers["content-type"] = "application/x-www-form-urlencoded";
    const req = httpRequest(proxy.url + path, { headers, method: body ? "POST" : "GET" }, (response) => {
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on("error", reject);
    req.end(body);
  });
  const websocketStatus = () => new Promise((resolve, reject) => {
    const headers = { host: target.host, origin: publicOrigin, connection: "Upgrade", upgrade: "websocket" };
    if (cookie) headers.cookie = cookie;
    const req = httpRequest(proxy.url + "/ws?at=%2Fdocument%2Fother-id", { headers });
    req.on("response", (res) => { res.resume(); resolve(res.statusCode); });
    req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on("error", reject);
    req.end();
  });
  const page = "/document/other-id?view=full";
  const loginPath = "/__paseo_ryugi/login?next=" + encodeURIComponent(page);
  assert.equal((await request("/")).status, 401);
  const prompt = await request(page, { accept: "text/html" });
  assert.equal(prompt.status, 401);
  assert.ok(prompt.body.includes(loginPath));
  assert.equal(await websocketStatus(), 401);
  assert.equal((await request("/api/hub/projects")).status, 401);
  assert.equal((await request(loginPath, { body: "password=wrong" })).status, 401);
  const credentials = new URLSearchParams({ password }).toString();
  assert.equal((await request(loginPath, { origin: "https://untrusted.example", body: credentials })).status, 403);
  assert.equal((await request("/__paseo_ryugi/login?next=%2F%2Funtrusted.example", { body: credentials })).status, 400);
  const login = await request(loginPath, { body: credentials });
  assert.equal(login.status, 303);
  assert.equal(login.headers.location, publicOrigin + page);
  assert.match(login.headers["set-cookie"][0], /Secure; HttpOnly/);
  cookie = login.headers["set-cookie"][0].split(";")[0];
  assert.equal((await request(page)).status, 200);
  assert.equal(JSON.parse((await request("/")).body).url, "/");
  assert.equal((await request("/native-redirect")).headers.location, publicOrigin + "/document/other-id?native=1");
  assert.equal(await websocketStatus(), 101);
  const metadata = await request("/api/artifacts/artboard/example");
  assert.deepEqual(JSON.parse(metadata.body), { contentBase, title: "Artboard" });
  assert.equal((await request(contentBase + "pages/example.html", { origin: "null" })).body, "<p>Board content</p>");
  const comments = "/api/whiteboard/embedded/scene?at=%2Fdocument%2Fother-id";
  assert.deepEqual(JSON.parse((await request(comments)).body), {
    url: comments,
    method: "GET",
    host: target.host,
    origin: target.origin,
  });
  const manager = await request("/api/hub/projects");
  assert.equal(manager.status, 200);
  assert.equal(JSON.parse(manager.body).url, "/api/hub/projects");
  assert.equal(JSON.parse((await request(page, { body: "other=application-data" })).body).method, "POST");
  assert.equal((await request("/document/actual-id", { origin: "https://untrusted.example" })).status, 403);
});

test("按端口复用隧道，切换端口不关闭上一条隧道", async (t) => {
  if (process.platform === "win32") return t.skip("uses a Unix executable fixture");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createQuickTunnel } = require("../server/quickTunnel.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-tunnel-"));
  const binary = path.join(dir, "cloudflared");
  const calls = path.join(dir, "calls");
  fs.writeFileSync(binary, `#!${process.execPath}
const fs = require("node:fs");
const calls = ${JSON.stringify(calls)};
fs.appendFileSync(calls, JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }) + "\\n");
console.error("https://unit-test-" + process.pid + ".trycloudflare.com");
console.error("Registered tunnel connection");
setInterval(() => {}, 500);
`, { mode: 0o700 });
  const tunnel = createQuickTunnel(binary);
  const states = [];
  t.after(tunnel.subscribe((active) => states.push(active)));
  t.after(() => { tunnel.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const local = "http://localhost:27523/document/actual-id?view=full#answer";
  const password = "proxy-password";
  const otherPage = "http://localhost:27523/artboard/second-id?mode=preview";
  const [documentUrl, boardUrl] = await Promise.all([
    tunnel.open(local, password),
    tunnel.open(otherPage, password),
  ]);
  const launches = () => fs.readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
  const [first] = launches();
  const firstOrigin = `https://unit-test-${first.pid}.trycloudflare.com`;
  assert.equal(launches().length, 1);
  assert.equal(documentUrl, firstOrigin + "/document/actual-id?view=full#answer");
  assert.equal(boardUrl, firstOrigin + "/artboard/second-id?mode=preview");
  assert.equal(await tunnel.open(otherPage.replace("localhost", "127.0.0.1"), password), boardUrl);
  assert.equal(launches().length, 1);
  assert.deepEqual(first.args.slice(0, 4), ["tunnel", "--no-autoupdate", "--protocol", "http2"]);
  assert.deepEqual(first.args.slice(-2), ["--http-host-header", "localhost:27523"]);
  process.kill(first.pid);
  for (let attempts = 0; attempts < 100; attempts++) {
    try { process.kill(first.pid, 0); } catch { break; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setImmediate(resolve));
  const rebuilt = await tunnel.open(local, password);
  assert.notEqual(rebuilt, documentUrl);
  assert.equal(launches().length, 2);
  const secondPort = await tunnel.open(local.replace(":27523", ":27524"), password);
  assert.notEqual(secondPort, rebuilt);
  assert.ok(launches().at(-1).args.includes("localhost:27524"));
  assert.equal(await tunnel.open(local, password), rebuilt);
  assert.equal(launches().length, 3);
  assert.deepEqual(states, [false, true, false, true]);
  const proxyUrls = launches().slice(1).map(({ args }) => args[5]);
  assert.equal(tunnel.stop(), true);
  assert.equal(tunnel.stop(), false);
  assert.deepEqual(states.slice(0, 2), [false, true]);
  assert.equal(states.at(-1), false);
  for (const url of proxyUrls) await assert.rejects(fetch(url));
  await tunnel.open(local, password);
  assert.equal(launches().length, 4);
  assert.equal(states.at(-1), true);
});

test("旧邮箱配置不会开启远程访问，密码由宿主保存", () => {
  const { remoteAccessSettings } = require("../shared/remoteAccess.ts");
  assert.deepEqual(remoteAccessSettings.schema.parse({}), { password: "" });
  assert.deepEqual(remoteAccessSettings.schema.parse({ email: "old@example.com" }), { password: "" });
  assert.deepEqual(remoteAccessSettings.schema.parse({ password: "my password" }), { password: "my password" });
});
