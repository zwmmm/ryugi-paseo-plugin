const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { PluginTranslationRuntime } = require("@getpaseo/plugin/client/host");

test("入口直接打开工件地址，客户端不投递消息或修改草稿", async () => {
  const load = Module._load;
  const opened = [];
  Module._load = function (name, ...args) {
    if (name === "@getpaseo/plugin/client/ui") return { Icon: "Icon" };
    if (name === "react-native") return { Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: (styles) => styles } };
    if (name === "@getpaseo/plugin/client") return { ...load.call(this, name, ...args), openExternalUrl: async (url) => opened.push(url) };
    return load.call(this, name, ...args);
  };
  let contribute;
  try { contribute = require("../index.client.tsx").default; } finally { Module._load = load; }
  let observer;
  let onChange;
  let pill;
  const active = new Set();
  const buttons = new Map();
  let artifacts = [{ artifact: "artboard/login", url: "http://localhost/x" }];
  const agent = { id: "agent", workspaceId: "ws" };
  let transformer;
  let renderer;
  let locale = "en";
  const runtime = new PluginTranslationRuntime({ getLocale: () => locale, subscribe: () => () => {} });
  const client = {
    addTimelineTransformer: (value) => { transformer = value; return () => {}; },
    addTimelineRenderer: (value) => { renderer = value; return () => {}; },
    addComposerPill: ({ id, button }) => { active.add(id); buttons.set(id, button); pill = button; return { remove: () => active.delete(id) }; },
    subscribe: (_contract, _input, callback) => { onChange = callback; return Object.assign(() => {}, { ready: Promise.resolve() }); },
    rpc: async () => ({ artifacts }),
    paseo: { agents: { list: async () => ({ subscription: { subscribe: (o) => { observer = o; o.snapshot({ entries: [{ agent }] }); } } }) } },
  };
  const cleanup = contribute(client);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  try {
    await settle(); await settle();
    const text = 'Ryugi monitor: ryugi-answers\n通知\n' + JSON.stringify({ type: 'ryugi-answers', project: '/project', artifact: 'document/test', questions: 4 });
    const replacement = transformer.transform({ item: { type: 'user_message', text }, phase: 'complete' });
    assert.equal(replacement.items[0].data.type, 'ryugi-answers');
    assert.equal(replacement.items[0].data.count, 4);
    assert.equal(replacement.items[0].data.text, text);
    assert.equal(renderer.kind, replacement.items[0].kind);
    assert.equal(transformer.transform({ item: { type: 'user_message', text: '正常的用户消息' }, phase: 'complete' }), undefined);
    assert.deepEqual([...active], ["ryugi-artboard"]);
    assert.equal(runtime.resolve(pill.title), "Artboard");
    locale = "zh-CN";
    assert.equal(runtime.resolve(pill.title), "画板");
    await pill.behavior.onPress();
    assert.deepEqual(opened, ["http://localhost/x"]);
    onChange({ changed: true });
    await settle(); await settle();
    assert.deepEqual([...active], ["ryugi-artboard"]);
    const kinds = ['document', 'artboard', 'html', 'slides', 'whiteboard', 'verify', 'report', 'storyboard'];
    artifacts = kinds.map((kind) => ({ artifact: `${kind}/example`, url: `http://localhost/${kind}/actual-id?key=test` }));
    artifacts.push({ artifact: 'slides/second', url: 'http://localhost/slides/second-id' });
    onChange({ changed: true });
    await settle(); await settle();
    assert.deepEqual([...active].sort(), kinds.map((kind) => `ryugi-${kind}`).sort());
    const titles = ['文档', '画板', 'HTML', '幻灯片', '白板', '验证报告', '数据报告', '分镜'];
    for (let i = 0; i < kinds.length; i++) {
      const button = buttons.get(`ryugi-${kinds[i]}`);
      assert.equal(runtime.resolve(button.title), titles[i]);
      await button.behavior.onPress();
      assert.equal(opened.at(-1), artifacts[i].url);
    }
    locale = 'en';
    assert.equal(runtime.resolve(buttons.get('ryugi-slides').title), 'Slides');
    artifacts = [{ artifact: 'html/updated', url: 'http://localhost/html/updated-id?key=new' }];
    onChange({ changed: true });
    await settle(); await settle();
    assert.deepEqual([...active], ['ryugi-html']);
    await buttons.get('ryugi-html').behavior.onPress();
    assert.equal(opened.at(-1), 'http://localhost/html/updated-id?key=new');
    observer.update({ type: 'agent_update', payload: { kind: 'remove', agentId: 'agent' } });
    assert.equal(active.size, 0);
  } finally { cleanup(); }
});
