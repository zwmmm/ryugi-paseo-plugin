const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { RealRyugiBridge, realRyugiBridge } = require("../server/realRyugiBridge.ts");
const Module = require("node:module");
const originalLoad = Module._load;
let serverHome;
const remoteOpens = [];
Module._load = function (name, ...args) {
  if (name === "./server/privateRuntime.js") return { getPrivateRuntime: () => ({ runtimeDir: "/private", serverHome, getProjectDir: (dir) => dir }) };
  if (name === "./server/quickTunnel.js") {
    const actual = originalLoad.call(this, name, ...args);
    return { ...actual, createQuickTunnel: () => ({ stop() {}, open: async (...input) => { remoteOpens.push(input); return "https://fixture.trycloudflare.com/"; } }) };
  }
  if (name === "./server/workflowIntegration.js") return {};
  if (name === "./server/monitorSessions.js") return { createMonitorSessions: () => ({ bind() {}, remove() {}, close() {} }) };
  return originalLoad.call(this, name, ...args);
};
const server = require("../index.server.ts").default;
Module._load = originalLoad;

test("只将会话交付的工件归属给该会话", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-session-"));
  const oldArtifacts = realRyugiBridge.sessionArtifacts;
  try {
    const artDir = path.join(dir, ".ryugi/artifacts/artboard/login");
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(path.join(artDir, ".artifact-id"), "actual-id");
    const cli = path.join(dir, "fake.cjs");
    fs.writeFileSync(cli, `const a=process.argv.slice(2);console.log(JSON.stringify({outcome:'success',data:a[0]==='get'?{items:[{artifact:'artboard/login'}]}:{url:'http://localhost:27319/artboard/actual-id'}}));`);
    const bridge = new RealRyugiBridge(cli);
    realRyugiBridge.sessionArtifacts = bridge.sessionArtifacts.bind(bridge);
    let handler;
    const cleanup = server({ registerSettings: () => ({ subscribe: () => () => {} }), addHook: () => () => {}, handle: (contract, fn) => { if (contract.name === "ryugi.session-data") handler = fn; } });
    const agent = { current: () => ({ workspaceId: "ws" }), timeline: { refetch: async () => ({ entries: [{ item: { type: "assistant_message", text: "[画板](http://localhost:27319/artboard/actual-id?view=canvas#login)" } }], hasOlder: false }) } };
    const context = { paseo: { workspaces: { ref: () => ({ current: () => ({ id: "ws", name: "工作区", projectRootPath: dir }) }) }, agents: { ref: () => agent } } };
    const result = await handler({ agentId: "session", workspaceId: "ws" }, context);
    assert.equal(result.artifacts[0].artifact, "artboard/login");
    const probe = await fetch(result.localProbe);
    assert.equal(await probe.text(), new URL(result.localProbe).pathname.slice(1));

    const references = [
      "/artboard/actual-id",
      "https://localhost:27319/artboard/actual-id",
      "http://localhost.example:27319/artboard/actual-id",
      "http://localhost:27319/artboard/actual-id-extra",
      "http://localhost:27319/artboard/actual-id/extra",
    ];
    agent.timeline.refetch = async () => ({ entries: [{ item: { type: "assistant_message", text: references.join("\n") } }], hasOlder: false });
    assert.deepEqual((await handler({ agentId: "other", workspaceId: "ws" }, context)).artifacts, []);
    await cleanup();
  } finally {
    realRyugiBridge.sessionArtifacts = oldArtifacts;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("远程入口仅用目标 URL，并限制在 Ryugi 实际监听端口", async (t) => {
  serverHome = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-port-"));
  t.after(() => fs.rmSync(serverHome, { recursive: true, force: true }));
  fs.writeFileSync(path.join(serverHome, "server-info"), JSON.stringify({ url: "http://localhost:27523/" }));
  let open;
  const cleanup = server({
    registerSettings: () => ({ read: async () => ({ status: "ready", values: { password: "fixture-password" } }), subscribe: () => () => {} }),
    addHook: () => () => {},
    handle(contract, fn) { if (contract.name === "ryugi.remote-artifact") open = fn; },
  });
  t.after(cleanup);
  await assert.rejects(open({ url: "http://localhost:27524/document/other" }), /服务端口已变更/);
  const url = "http://127.0.0.1:27523/document/another-session";
  assert.deepEqual(await open({ url }), { url: "https://fixture.trycloudflare.com/" });
  assert.deepEqual(remoteOpens, [[url, "fixture-password"]]);
});

test("发现全部八类工件，仅打开当前会话引用的本地页面", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-types-"));
  try {
    const kinds = ['document', 'artboard', 'html', 'slides', 'whiteboard', 'verify', 'report', 'storyboard'];
    const items = kinds.map((kind) => ({ artifact: `${kind}/example` }));
    items.push({ artifact: 'html/unreferenced' });
    for (const { artifact } of items) {
      const folder = path.join(dir, '.artideck/artifacts', artifact);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, '.artifact-id'), artifact === 'html/unreferenced' ? 'other-id' : `${artifact.split('/')[0]}-id`);
    }
    const cli = path.join(dir, 'fake.cjs');
    fs.writeFileSync(cli, `const args=process.argv.slice(2);const type=args[args.indexOf('--artifact')+1]?.split('/')[0];console.log(JSON.stringify({outcome:'success',data:args[0]==='get'?{items:${JSON.stringify(items)}}:{url:'http://localhost:27419/'+type+'/'+type+'-id?key=test'}}));`);
    const bridge = new RealRyugiBridge(cli);
    const references = kinds.map((kind) => `http://localhost:27419/${kind}/${kind}-id?key=test#section`);
    const found = await bridge.sessionArtifacts(dir, references);
    assert.deepEqual(found, kinds.map((kind) => ({ artifact: `${kind}/example`, url: `http://localhost:27419/${kind}/${kind}-id?key=test` })));
    assert.deepEqual(await bridge.sessionArtifacts(dir, ['http://localhost:27419/html/html-id/extra', 'https://localhost:27419/slides/slides-id']), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("设置可以在没有会话和 server-info 时启动 Ryugi 隧道", async (t) => {
  serverHome = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-manual-port-"));
  const previous = realRyugiBridge.startUrl;
  t.after(() => {
    realRyugiBridge.startUrl = previous;
    fs.rmSync(serverHome, { recursive: true, force: true });
  });
  let start;
  const cli = path.join(serverHome, "fixture.cjs");
  const calls = path.join(serverHome, "calls.json");
  fs.writeFileSync(cli, `
    require("node:fs").writeFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)));
    console.log(JSON.stringify({ outcome: "success", data: { url: "http://localhost:27525/?key=fixture-secret" } }));
  `);
  const bridge = new RealRyugiBridge(cli);
  realRyugiBridge.startUrl = bridge.startUrl.bind(bridge);
  const cleanup = server({
    registerSettings: () => ({ read: async () => ({ status: "ready", values: { password: "fixture-password" } }), subscribe: () => () => {} }),
    addHook: () => () => {},
    handle(contract, fn) { if (contract.name === "ryugi.start-tunnel") start = fn; },
  });
  t.after(cleanup);
  assert.equal(typeof start, "function");
  assert.deepEqual(await start({}), { url: "https://fixture.trycloudflare.com/" });
  assert.deepEqual(JSON.parse(fs.readFileSync(calls, "utf8")), ["start", "--background", "--no-open", "--project-dir", "/private", "--json"]);
  assert.deepEqual(remoteOpens.at(-1), ["http://localhost:27525/", "fixture-password"]);
});
