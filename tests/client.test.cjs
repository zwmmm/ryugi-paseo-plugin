const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("入口直接打开工件地址，客户端不投递消息或修改草稿", async () => {
  const load = Module._load;
  const opened = [];
  Module._load = function (name, ...args) {
    if (name === "@getpaseo/plugin/client") return { ...load.call(this, name, ...args), openExternalUrl: async (url) => opened.push(url) };
    return load.call(this, name, ...args);
  };
  let contribute;
  try { contribute = require("../index.client.tsx").default; } finally { Module._load = load; }
  let observer;
  let onChange;
  let pill;
  const active = new Set();
  const agent = { id: "agent", workspaceId: "ws" };
  const client = {
    addAttachmentSource: () => () => {},
    addComposerPill: ({ id, button }) => { active.add(id); pill = button; return { remove: () => active.delete(id) }; },
    subscribe: (_contract, _input, callback) => { onChange = callback; return Object.assign(() => {}, { ready: Promise.resolve() }); },
    rpc: async () => ({ artifacts: [{ artifact: "artboard/login", url: "http://localhost/x" }] }),
    paseo: { agents: { list: async () => ({ subscription: { subscribe: (o) => { observer = o; o.snapshot({ entries: [{ agent }] }); } } }) } },
  };
  const cleanup = contribute(client);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  try {
    await settle(); await settle();
    assert.deepEqual([...active], ["ryugi-artboard"]);
    await pill.behavior.onPress();
    assert.deepEqual(opened, ["http://localhost/x"]);
    onChange({ changed: true });
    await settle(); await settle();
    assert.deepEqual([...active], ["ryugi-artboard"]);
  } finally { cleanup(); }
});
