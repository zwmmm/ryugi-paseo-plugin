const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("入口直接打开工件地址，客户端不投递消息或修改草稿", async () => {
  const load = Module._load;
  const opened = [];
  Module._load = function (name, ...args) {
    if (name === "@getpaseo/plugin/client/ui") return { Icon: "Icon" };
    if (name === "react-native") return { Pressable: "Pressable", Text: "Text", View: "View" };
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
  let transformer;
  let renderer;
  const client = {
    addTimelineTransformer: (value) => { transformer = value; return () => {}; },
    addTimelineRenderer: (value) => { renderer = value; return () => {}; },
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
    const text = 'Ryugi monitor: ryugi-answers\n通知\n' + JSON.stringify({ type: 'ryugi-answers', project: '/project', artifact: 'document/test', questions: 4 });
    const replacement = transformer.transform({ item: { type: 'user_message', text }, phase: 'complete' });
    assert.equal(replacement.items[0].data.summary, 'Ryugi · 已提交 4 个问题的回答');
    assert.equal(replacement.items[0].data.text, text);
    assert.equal(renderer.kind, replacement.items[0].kind);
    assert.equal(transformer.transform({ item: { type: 'user_message', text: '正常的用户消息' }, phase: 'complete' }), undefined);
    assert.deepEqual([...active], ["ryugi-artboard"]);
    await pill.behavior.onPress();
    assert.deepEqual(opened, ["http://localhost/x"]);
    onChange({ changed: true });
    await settle(); await settle();
    assert.deepEqual([...active], ["ryugi-artboard"]);
  } finally { cleanup(); }
});
