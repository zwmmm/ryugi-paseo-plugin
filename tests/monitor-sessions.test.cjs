const assert = require("node:assert/strict");
const test = require("node:test");
const { createMonitorSessions } = require("../server/monitorSessions.ts");

test("monitor 事件发送到绑定会话，消息 ID 稳定且失败可重试", async () => {
  let options;
  let updates = 0;
  let closes = 0;
  let fail = true;
  const delivered = [];
  const runtime = { serverHome: "/private/server", socketPath: "/private/hub.sock" };
  const sessions = createMonitorSessions((input) => { options = input; return { close() { closes++; }, updateBindings() { updates++; } }; }, runtime);
  const paseo = { agents: { ref(id) {
    assert.equal(id, "agent");
    return { refresh: async () => ({ agent: { workspaceId: "ws" } }), send: async (text, opts) => {
      delivered.push({ text, ...opts });
      if (fail) { fail = false; throw new Error("offline"); }
    } };
  } } };
  const bindings = [{ project: "/project", artifact: "artboard/login" }];
  sessions.bind("agent", "ws", bindings, paseo);
  sessions.bind("agent", "ws", bindings, paseo);
  assert.equal(updates, 1);
  assert.equal(options.serverHome, runtime.serverHome);
  assert.equal(options.socketPath, runtime.socketPath);
  const event = { type: "ryugi-choices", project: "/project", artifact: "artboard/login", withdrawn: true };
  await assert.rejects(options.onEvent(event, 1), /offline/);
  await options.onEvent(event, 1);
  assert.equal(delivered[0].messageId, delivered[1].messageId);
  assert.match(delivered[1].text, /用户已撤回/);
  assert.match(delivered[1].text, /groups/);
  sessions.close();
  assert.equal(closes, 1);
});
