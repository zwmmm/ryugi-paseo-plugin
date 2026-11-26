const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { PluginTranslationRuntime } = require("@getpaseo/plugin/client/host");

test("插件设置控制工件打开方式，并在同一行显示 Ryugi 版本和更新操作", async () => {
  const load = Module._load;
  const external = [];
  const opened = [];
  const remoteCalls = [];
  const originalFetch = global.fetch;
  let probe;
  let renderingDesign = false;
  let designStatus;
  let onRuntimeStatus;
  const runtimeCalls = [];
  Module._load = function (name, ...args) {
    if (name === "react") return {
      ...load.call(this, name, ...args),
      useEffect: (effect) => effect(),
      useState: (initial) => renderingDesign && initial === undefined
        ? [designStatus, (status) => { designStatus = status; }]
        : [initial, () => {}],
    };
    if (name === "@getpaseo/plugin/client/ui") return { Icon: "Icon", ExternalLink: "ExternalLink", SettingsCard: "SettingsCard", SettingsSelect: "SettingsSelect", SettingsAction: "SettingsAction" };
    if (name === "react-native") return { Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: (styles) => styles } };
    if (name === "@getpaseo/plugin/client") return {
      ...load.call(this, name, ...args),
      openExternalUrl: async (url) => external.push(url),
      useTranslation: (messages) => ({ t: (key, values) => renderingDesign ? runtime.resolve(messages.message(key, values)) : key }),
      useRpc: (contract) => async () => { runtimeCalls.push(contract.name); },
      useSubscription: (contract, _input, onEvent) => {
        assert.equal(contract.name, "ryugi.runtime-update-status");
        onRuntimeStatus = onEvent;
        return { status: "live" };
      },
      useSettings: (definition) => ({
        status: "ready", values: definition.schema.parse({}), revision: "current", saving: false,
        save: async (values, revision) => { saved.push({ values, revision }); onBrowserChange?.(values); return true; },
      }),
    };
    return load.call(this, name, ...args);
  };
  let contribute;
  try { contribute = require("../index.client.tsx").default; } finally { Module._load = load; }
  let observer;
  let onChange;
  let onBrowserChange;
  const settingsScreens = new Map();
  const saved = [];
  let pill;
  const active = new Set();
  const buttons = new Map();
  let artifacts = [{ artifact: "artboard/login", url: "http://localhost/x" }];
  const agent = { id: "agent", workspaceId: "ws" };
  let transformer;
  let renderer;
  let screen;
  let route;
  const desktop = { openBrowser: (target) => opened.push(target) };
  const renderScreen = (navigation) => screen.Component({
    params: route.params,
    navigation,
    theme: { colors: { foreground: "#000" } },
    layout: { compact: false },
  });
  let locale = "en";
  const runtime = new PluginTranslationRuntime({ getLocale: () => locale, subscribe: () => () => {} });
  const client = {
    addSettingsScreen: (value) => { settingsScreens.set(value.id, value); return () => {}; },
    addScreen: (value) => { screen = value; return () => {}; },
    openScreen: (value) => { route = value; renderScreen(desktop); },
    addTimelineTransformer: (value) => { transformer = value; return () => {}; },
    addTimelineRenderer: (value) => { renderer = value; return () => {}; },
    addComposerPill: ({ id, button }) => { active.add(id); buttons.set(id, button); pill = button; return { remove: () => active.delete(id) }; },
    subscribe: (contract, _input, callback) => {
      if (contract.name === "ryugi.workspace-changes") onChange = callback;
      else onBrowserChange = callback;
      return Object.assign(() => {}, { ready: Promise.resolve() });
    },
    rpc: async (contract, input) => {
      if (contract.name === "ryugi.remote-artifact") {
        remoteCalls.push(input);
        return { url: "https://client-test.trycloudflare.com/html/updated-id?key=new" };
      }
      return { artifacts, localProbe: probe };
    },
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
    assert.deepEqual(opened, [{ url: "http://localhost/x", workspaceId: "ws" }]);
    renderScreen(desktop);
    assert.equal(opened.length, 1);
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
      assert.deepEqual(opened.at(-1), { url: artifacts[i].url, workspaceId: "ws" });
    }
    locale = 'en';
    assert.equal(runtime.resolve(buttons.get('ryugi-slides').title), 'Slides');
    artifacts = [{ artifact: 'html/updated', url: 'http://localhost/html/updated-id?key=new' }];
    onChange({ changed: true });
    await settle(); await settle();
    assert.deepEqual([...active], ['ryugi-html']);
    await buttons.get('ryugi-html').behavior.onPress();
    assert.deepEqual(opened.at(-1), { url: 'http://localhost/html/updated-id?key=new', workspaceId: "ws" });
    assert.deepEqual(external, []);
    client.openScreen = (value) => { route = value; };
    await buttons.get('ryugi-html').behavior.onPress();
    const fallback = renderScreen(undefined);
    assert.equal(fallback.props.children.props.href, 'http://localhost/html/updated-id?key=new');
    assert.equal(opened.length, 10);
    assert.deepEqual(external, []);
    const { children: select } = settingsScreens.get("browser").Component({ theme: { colors: { foreground: "#000" } } }).props;
    assert.equal(select.props.value, "paseo");
    await select.props.onValueChange("system");
    assert.deepEqual(saved, [{ values: { browser: "system" }, revision: "current" }]);
    const previousRoute = route;
    await buttons.get('ryugi-html').behavior.onPress();
    assert.deepEqual(external, ['http://localhost/html/updated-id?key=new']);
    assert.equal(route, previousRoute);
    onBrowserChange({ browser: "paseo" });
    client.openScreen = (value) => { route = value; renderScreen(desktop); };
    await buttons.get('ryugi-html').behavior.onPress();
    assert.equal(opened.length, 11);
    probe = "http://127.0.0.1:49152/this-host";
    onChange({ changed: true });
    await settle();
    global.fetch = async () => ({ ok: true, text: async () => "this-host" });
    await buttons.get('ryugi-html').behavior.onPress();
    assert.equal(opened.at(-1).url, "http://localhost/html/updated-id?key=new");
    assert.deepEqual(remoteCalls, []);
    global.fetch = async () => ({ ok: true, text: async () => "different-host" });
    await buttons.get('ryugi-html').behavior.onPress();
    assert.equal(opened.at(-1).url, "https://client-test.trycloudflare.com/html/updated-id?key=new");
    assert.deepEqual(remoteCalls, [{ url: "http://localhost/html/updated-id?key=new" }]);
    onBrowserChange({ browser: "system" });
    await buttons.get('ryugi-html').behavior.onPress();
    assert.equal(external.at(-1), "https://client-test.trycloudflare.com/html/updated-id?key=new");
    observer.update({ type: 'agent_update', payload: { kind: 'remove', agentId: 'agent' } });
    assert.equal(active.size, 0);

    const design = settingsScreens.get("design");
    assert.ok(design, "插件应注册设计设置页面");
    locale = "zh-CN";
    assert.equal(runtime.resolve(design.title), "设计");
    renderingDesign = true;
    const renderDesign = () => design.Component({}).props.children;
    assert.equal(renderDesign().props.disabled, true);
    onRuntimeStatus({ version: "1.108.1", phase: "idle" });
    const cell = renderDesign();
    assert.equal(cell.type, "SettingsAction");
    assert.match(cell.props.hint, /1\.108\.1/);
    assert.equal(cell.props.actionLabel, "手动更新");
    await cell.props.onPress();
    assert.deepEqual(runtimeCalls, ["ryugi.start-runtime-update"]);
    onRuntimeStatus({ version: "1.108.1", phase: "updating" });
    assert.equal(renderDesign().props.disabled, true);
    onRuntimeStatus({ version: "1.200.0", phase: "updated" });
    assert.match(renderDesign().props.hint, /1\.200\.0/);
    onRuntimeStatus({ version: "1.200.0", phase: "current" });
    assert.match(renderDesign().props.hint, /已是最新版本/);
    onRuntimeStatus({ version: "1.200.0", phase: "failed" });
    assert.match(renderDesign().props.error, /更新 Ryugi 失败/);
    assert.equal(renderDesign().props.disabled, false);
  } finally { global.fetch = originalFetch; cleanup(); }
});
