const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { RealRyugiBridge, realRyugiBridge } = require("../server/realRyugiBridge.ts");
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === "./server/privateRuntime.js") return { getPrivateRuntime: () => ({ getProjectDir: (dir) => dir }) };
  if (name === "./server/workflowIntegration.js") return {};
  if (name === "./server/monitorSessions.js") return { createMonitorSessions: () => ({ bind() {}, remove() {}, close() {} }) };
  return originalLoad.call(this, name, ...args);
};
const server = require("../index.server.ts").default;
Module._load = originalLoad;

test("搜索评论包含工作区、全部回复和锚点，并处理分页", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-bridge-"));
  try {
    fs.mkdirSync(path.join(dir, ".ryugi", "artifacts"), { recursive: true });
    const cli = path.join(dir, "fake.cjs");
    const commands = path.join(dir, "commands.jsonl");
    fs.writeFileSync(cli, `
      const assert = require('node:assert/strict');
      const a = process.argv.slice(2);
      require('node:fs').appendFileSync(${JSON.stringify(commands)}, JSON.stringify(a[0]) + '\\n');
      let data, page;
      if (a[0] === 'get') data = {items:[{artifact:'document/demo'}]};
      else if (a[0] === 'start') data = {url:'http://localhost:27319/document/stable-id'};
      else {
        const second = a.includes('--cursor');
        if (second) {
          assert.equal(a[a.indexOf('--cursor') + 1], 'next');
          assert.equal(a[a.indexOf('--snapshot') + 1], 'snapshot');
        }
        data = {items:[{id:second?'thread-2':'thread-1',status:'open',anchor:{blockId:'p1',quote:'原文'},messages:[{author:'human',text:second?'第二条':'第一条',at:'2026-01-01'},{author:'agent',text:'完整回复',at:'2026-01-02'}]}],snapshot:'snapshot'};
        page = {hasMore:!second,nextCursor:second?null:'next'};
      }
      console.log(JSON.stringify({outcome:'success',data,page}));
    `);
    const bridge = new RealRyugiBridge(cli);
    const result = await bridge.searchComments("完整回复", [{ id: "ws1", name: "工作区一", projectDir: dir }]);
    assert.equal(result.items.length, 2);
    assert.match(result.items[0].text, /第一条/);
    assert.match(result.items[0].text, /完整回复/);
    assert.match(result.items[0].text, /原文/);
    assert.match(result.items[0].subtitle, /工作区一/);
    assert.equal(result.items[0].url, "http://localhost:27319/document/stable-id");
    assert.notEqual(result.items[0].id, result.items[1].id);
    assert.deepEqual((await bridge.searchComments("不存在", [{ id: "ws1", name: "工作区一", projectDir: dir }])).items, []);
    fs.truncateSync(commands);
    const resolved = [{ artifact: "document/demo", url: "http://127.0.0.1:27320/document/stable-id" }];
    const reused = await bridge.searchComments("", [{ id: "ws1", name: "工作区一", projectDir: dir }], resolved);
    assert.equal(reused.items[0].url, resolved[0].url);
    assert.deepEqual(fs.readFileSync(commands, "utf8").trim().split("\n").map(JSON.parse), ["comment", "comment"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("搜索 RPC 翻页并标记工作区", async () => {
  let handler;
  server({ addHook: () => () => {}, handle: (contract, fn) => { if (contract.name === "ryugi.search-attachments") handler = fn; } });
  const old = realRyugiBridge.searchComments;
  try {
    realRyugiBridge.searchComments = async (query, workspaces) => ({ query, workspaces });
    const seen = [];
    const result = await handler({ query: "x" }, { paseo: { workspaces: { list: async ({ page }) => {
      seen.push(page.cursor);
      return page.cursor
        ? { entries: [{ id: "b", name: "B", projectRootPath: "/b" }], pageInfo: { hasMore: false } }
        : { entries: [{ id: "a", name: "A", workspaceDirectory: "/a", projectRootPath: "/root" }], pageInfo: { hasMore: true, nextCursor: "next" } };
    } } } });
    assert.deepEqual(seen, [undefined, "next"]);
    assert.deepEqual(result.workspaces.map((x) => x.projectDir), ["/a", "/b"]);
  } finally {
    realRyugiBridge.searchComments = old;
  }
});

test("只将会话交付的工件和待处理评论归属给该会话", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-session-"));
  const oldArtifacts = realRyugiBridge.sessionArtifacts;
  const oldSearch = realRyugiBridge.searchComments;
  try {
    const artDir = path.join(dir, ".ryugi/artifacts/artboard/login");
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(path.join(artDir, ".artifact-id"), "actual-id");
    const cli = path.join(dir, "fake.cjs");
    fs.writeFileSync(cli, `const a=process.argv.slice(2);console.log(JSON.stringify({outcome:'success',data:a[0]==='get'?{items:[{artifact:'artboard/login'}]}:{url:'http://localhost:27319/artboard/actual-id'}}));`);
    const bridge = new RealRyugiBridge(cli);
    realRyugiBridge.sessionArtifacts = bridge.sessionArtifacts.bind(bridge);
    realRyugiBridge.searchComments = async (_q, _w, selected, waiting) => {
      assert.deepEqual(selected, [{ artifact: "artboard/login", url: "http://localhost:27319/artboard/actual-id" }]);
      assert.equal(waiting, true);
      return { items: [{ id: "comment", identifier: "#comment", title: "换图", subtitle: "login", text: "换一个好看一点的图", url: "http://localhost:27319/artboard/actual-id", resourceType: "ryugi-comment" }] };
    };
    let handler;
    server({ addHook: () => () => {}, handle: (contract, fn) => { if (contract.name === "ryugi.session-data") handler = fn; } });
    const agent = { current: () => ({ workspaceId: "ws" }), timeline: { refetch: async () => ({ entries: [{ item: { type: "assistant_message", text: "[画板](http://localhost:27319/artboard/actual-id?view=canvas#login)" } }], hasOlder: false }) } };
    const context = { paseo: { workspaces: { ref: () => ({ current: () => ({ id: "ws", name: "工作区", projectRootPath: dir }) }) }, agents: { ref: () => agent } } };
    const result = await handler({ agentId: "session", workspaceId: "ws" }, context);
    assert.equal(result.artifacts[0].artifact, "artboard/login");

    const references = [
      "/artboard/actual-id",
      "https://localhost:27319/artboard/actual-id",
      "http://localhost.example:27319/artboard/actual-id",
      "http://localhost:27319/artboard/actual-id-extra",
      "http://localhost:27319/artboard/actual-id/extra",
    ];
    agent.timeline.refetch = async () => ({ entries: [{ item: { type: "assistant_message", text: references.join("\n") } }], hasOlder: false });
    assert.deepEqual((await handler({ agentId: "other", workspaceId: "ws" }, context)).artifacts, []);
  } finally {
    realRyugiBridge.sessionArtifacts = oldArtifacts;
    realRyugiBridge.searchComments = oldSearch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
