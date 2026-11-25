const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createRyugiTool, ryugiInstructions } = require('../server/workflowIntegration.ts');

test('私有工具保留 CLI 待处理结果，限制项目并强制后台/no-open', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ryugi-tool-'));
  try {
    const cliPath = path.join(dir, 'fake.cjs');
    fs.writeFileSync(cliPath, `console.log(JSON.stringify({args:process.argv.slice(2),home:process.env.RYUGI_SERVER_HOME}));process.exit(process.argv.includes('check')?4:0)`);
    const runtime = { cliPath, env: { ...process.env, RYUGI_SERVER_HOME: dir } };
    const starts = [];
    const tool = createRyugiTool(runtime, dir, async (out) => starts.push(out));
    const context = { signal: new AbortController().signal };
    const result = await tool.execute({ args: ['start', '--artifact', 'document/test'] }, context);
    assert.equal(result.isError, false);
    const data = JSON.parse(result.text);
    assert.deepEqual(data.args, ['start', '--artifact', 'document/test', '--project-dir', dir, '--background', '--no-open', '--json']);
    assert.equal(data.home, dir);
    assert.equal(starts.length, 1);
    const pending = await tool.execute({ args: ['check'] }, context);
    assert.equal(pending.isError, false);
    assert.match(pending.text, /check/);
    for (const args of [['install'], ['hook'], ['update'], ['start', '--foreground'], ['get', '--project-dir=/other']]) {
      assert.equal((await tool.execute({ args }, context)).isError, true);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('full skills 使用私有绝对路径且注入会话工具，不改其他启动配置', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ryugi-skills-'));
  const Module = require('node:module');
  const originalLoad = Module._load;
  try {
    for (const name of ['using-ryugi', 'brainstorming', 'artifacts', 'executing-specs']) {
      fs.mkdirSync(path.join(dir, name));
      fs.writeFileSync(path.join(dir, name, 'SKILL.md'), name);
    }
    const runtime = { runtimeDir: dir, skillsDir: dir, getProjectDir: () => '/private-project' };
    const prompt = ryugiInstructions(runtime, '/private-project', '/source');
    assert.match(prompt, new RegExp(path.join(dir, 'brainstorming', 'SKILL.md')));
    assert.match(prompt, /Never open, inspect or automate/);
    assert.match(prompt, /Source workspace: \/source/);
    Module._load = function (name, ...args) {
      if (name === './server/privateRuntime.js') return { getPrivateRuntime: () => runtime };
      if (name === './server/monitorSessions.js') return { createMonitorSessions: () => ({ bind() {}, close() {} }) };
      return originalLoad.call(this, name, ...args);
    };
    const contribute = require('../index.server.ts').default;
    Module._load = originalLoad;
    const hooks = {};
    let settingsListener;
    let browserChanges;
    const cleanup = contribute({
      handle(contract, fn) {
        if (contract.name === "ryugi.browser-changes") browserChanges = fn;
      },
      registerSettings(definition) {
        return {
          read: async () => ({ status: "ready", values: definition.schema.parse({}) }),
          subscribe(listener) { if (definition.id !== "browser") return () => {}; settingsListener = listener; return () => { settingsListener = undefined; }; },
        };
      },
      addHook(name, fn) { hooks[name] = fn; return () => {}; },
    });
    const browserEvents = [];
    const subscription = new AbortController();
    try {
      assert.ok(browserChanges, "插件应提供浏览器设置订阅");
      const listening = browserChanges({}, { push: async (event) => browserEvents.push(event), signal: subscription.signal });
      await new Promise((resolve) => setImmediate(resolve));
      await settingsListener({ status: "ready", values: { browser: "system" } });
      subscription.abort();
      await listening;
      assert.deepEqual(browserEvents, [{ browser: "paseo" }, { browser: "system" }]);
      assert.equal(settingsListener, undefined);
    } finally { subscription.abort(); }
    const context = { paseo: { workspaces: { ref: () => ({ current: () => ({ workspaceDirectory: '/source' }) }) } } };
    const request = { purpose: 'interactive', agentId: 'a', workspaceId: 'w', cwd: '/source', tools: [{ name: 'existing' }], appendSystemPrompt: ['existing prompt'], env: { KEEP: 'yes' } };
    const updated = await hooks['agent.open.before']({ request }, context);
    assert.deepEqual(updated.tools.map(t => t.name), ['existing', 'ryugi']);
    assert.equal(updated.appendSystemPrompt[0], 'existing prompt');
    assert.equal(updated.appendSystemPrompt[1], prompt);
    assert.equal(updated.env, request.env);
    assert.deepEqual(request.tools, [{ name: 'existing' }]);
    assert.equal(await hooks['agent.open.before']({ request: { ...request, purpose: 'history' } }, context), undefined);
    await cleanup();
  } finally { Module._load = originalLoad; fs.rmSync(dir, { recursive: true, force: true }); }
});
