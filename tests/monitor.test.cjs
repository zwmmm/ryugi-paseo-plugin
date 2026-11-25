const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");
const { startMonitorChannel, subscribeMonitor } = require("../server/monitorChannel.ts");

async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("monitor timeout");
    await delay(5);
  }
}

async function fixture(t, onEvent, overrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-mon-"));
  const socketPath = path.join(home, "hub.sock");
  const messages = [];
  const sockets = [];
  const subscriptions = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        messages.push(message);
        if (message.t === "hello") socket.write('{"t":"welcome"}\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  const binding = { project: home, artifact: "document/plan" };
  const channel = startMonitorChannel({ agentId: "agent-1", bindings: [binding], socketPath, serverHome: home,
    retryMs: 20, subscribe: async (value) => { subscriptions.push(value); }, onEvent, ...overrides });
  t.after(async () => {
    channel.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  });
  await until(() => subscriptions.length === 1);
  const send = (message) => sockets.at(-1).write(`${JSON.stringify(message)}\n`);
  const event = (id, extra = {}) => send({ t: "event", id, event: { ...binding, type: "ryugi-comments", unread: 1, ...extra } });
  return { channel, binding, subscriptions, messages, sockets, send, event };
}

test("会话绑定后只接收三类语义事件，成功投递才确认，并去重", async (t) => {
  let resolveDelivery;
  const deliveries = [];
  const f = await fixture(t, async (event) => {
    deliveries.push(event);
    await new Promise((resolve) => { resolveDelivery = resolve; });
  });
  assert.equal(f.messages[0].host, "paseo");
  assert.equal(f.messages[0].session, "agent-1");
  assert.deepEqual(f.subscriptions[0], { ...f.binding, host: "paseo", session: "agent-1" });
  f.event(1, { artifact: "document/other" });
  f.event(2, { type: "change" });
  f.event(3);
  f.event(3);
  await until(() => deliveries.length === 1);
  assert.equal(f.messages.filter((m) => m.t === "delivered").length, 0);
  resolveDelivery();
  await until(() => f.messages.some((m) => m.t === "delivered"));
  f.event(3);
  await until(() => f.messages.filter((m) => m.t === "delivered").length === 2);
  assert.equal(deliveries.length, 1);
});

test("失败重试且不提前确认，retract 移除待投递项，断线重订阅，replaced 停止", async (t) => {
  let attempts = 0;
  const f = await fixture(t, async () => { if (++attempts < 2) throw new Error("busy"); });
  f.event(1, { type: "ryugi-answers" });
  await until(() => f.messages.some((m) => m.t === "delivered"));
  assert.equal(attempts, 2);
  f.sockets.at(-1).destroy();
  await until(() => f.subscriptions.length === 2);
  f.send({ t: "bye", reason: "replaced" });
  await delay(80);
  assert.equal(f.sockets.length, 2);
});

test("retract 取消等待重试的通知", async (t) => {
  let attempts = 0;
  const f = await fixture(t, async () => { attempts++; throw new Error("busy"); }, { retryMs: 100 });
  f.event(1);
  await until(() => attempts === 1);
  f.send({ t: "retract", ...f.binding, type: "ryugi-comments" });
  await delay(180);
  assert.equal(attempts, 1);
  assert.equal(f.messages.some((m) => m.t === "delivered"), false);
});

test("HTTP 订阅使用 server-info key 和项目 header，非成功状态抛错", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-sub-"));
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => body += chunk);
    req.on("end", () => {
      requests.push({ url: req.url, project: req.headers["x-ryugi-project"], body: JSON.parse(body) });
      res.writeHead(requests.length === 1 ? 204 : 503).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(home, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(home, "server-info"), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/?key=a%2Fb` }));
  const subscription = { host: "paseo", session: "a", project: "/项目 x", artifact: "document/a" };
  await subscribeMonitor(home, subscription);
  assert.deepEqual(requests[0], { url: "/api/agent/subscribe?key=a%2Fb", project: encodeURIComponent(subscription.project), body: subscription });
  await assert.rejects(subscribeMonitor(home, subscription), /503/);
});


test("所有工件类型的反馈都能投递并确认", async (t) => {
  const deliveries = [];
  const f = await fixture(t, async (event) => { deliveries.push(event.artifact); });
  const kinds = ['document', 'artboard', 'html', 'slides', 'whiteboard', 'verify', 'report', 'storyboard', 'preview'];
  f.channel.updateBindings(kinds.map((kind) => ({ project: f.binding.project, artifact: `${kind}/example` })));
  await until(() => f.subscriptions.length === 10);
  for (let i = 0; i < kinds.length; i++) f.event(i + 1, { artifact: `${kinds[i]}/example` });
  await until(() => f.messages.filter((message) => message.t === 'delivered').length === kinds.length);
  assert.deepEqual(deliveries, kinds.map((kind) => `${kind}/example`));
});
