const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { getPrivateRuntime, getProjectDir, RYUGI_VERSION, RYUGI_WORKFLOW_COMMIT } = require("../server/privateRuntime.ts");

function fixture(dir) {
  const pkg = path.join(dir, "node_modules", "ryugi-artifacts");
  fs.mkdirSync(path.join(pkg, "dist"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ version: RYUGI_VERSION }));
  fs.writeFileSync(path.join(pkg, "dist", "cli.cjs"), "");
  for (const name of ["using-ryugi", "brainstorming", "artifacts", "executing-specs"]) {
    const skills = path.join(dir, "workflow", "skills", name);
    fs.mkdirSync(skills, { recursive: true });
    fs.writeFileSync(path.join(skills, "SKILL.md"), `# ${name}`);
  }
  fs.writeFileSync(path.join(dir, "runtime.json"), JSON.stringify({ version: RYUGI_VERSION, workflowCommit: RYUGI_WORKFLOW_COMMIT }));
}

test("专用运行时使用底层 CLI 和隔离服务状态，不改变当前进程环境", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-runtime-test-"));
  const previous = process.env.PASEO_RYUGI_RUNTIME_DIR;
  const originalCli = process.env.RYUGI_CLI_PATH;
  const originalHome = process.env.RYUGI_SERVER_HOME;
  const customKeys = ["RYUGI_HUB_SOCKET", "RYUGI_ARTIFACTS_PORTS", "RYUGI_ARTIFACTS_BOARD_PORTS", "RYUGI_INSTALL_ROOT", "RYUGI_MANAGED_RUNTIME", "RYUGI_CUSTOM_USER_CONFIG"];
  const originals = Object.fromEntries(customKeys.map((key) => [key, process.env[key]]));
  for (const key of customKeys) process.env[key] = "user-custom";
  let socketDir;
  try {
    fixture(dir);
    process.env.PASEO_RYUGI_RUNTIME_DIR = dir;
    const runtime = getPrivateRuntime();
    socketDir = runtime.env.RYUGI_RUNTIME_DIR;
    assert.equal(runtime.cliPath, path.join(dir, "node_modules/ryugi-artifacts/dist/cli.cjs"));
    assert.equal(runtime.skillsDir, path.join(dir, "workflow/skills"));
    assert.equal(runtime.serverHome, path.join(dir, "state/server"));
    assert.equal(runtime.env.RYUGI_CLI_PATH, runtime.cliPath);
    assert.equal(runtime.env.RYUGI_SERVER_HOME, runtime.serverHome);
    assert.equal(runtime.env.PATH, process.env.PATH);
    assert.equal(runtime.env.HOME, process.env.HOME);
    assert.equal(runtime.runtimeDir, dir);
    assert.equal(runtime.env.RYUGI_HUB_SOCKET, runtime.socketPath);
    assert.match(path.basename(runtime.socketPath), /^hub-[a-f0-9]{12}\.sock$/);
    assert.equal(runtime.env.RYUGI_ARTIFACTS_PORTS, "27419,27420,27421");
    assert.equal(runtime.env.RYUGI_ARTIFACTS_BOARD_PORTS, "27429,27430,27431");
    for (const key of ["RYUGI_INSTALL_ROOT", "RYUGI_MANAGED_RUNTIME", "RYUGI_CUSTOM_USER_CONFIG"]) assert.equal(runtime.env[key], undefined);
    for (const key of customKeys) assert.equal(process.env[key], "user-custom");
    const workspace = path.join(dir, "user-workspace");
    const project = getProjectDir(workspace);
    assert.equal(project, runtime.getProjectDir(workspace));
    assert.match(project, new RegExp(`/projects/[a-f0-9]{16}$`));
    assert.equal(fs.statSync(project).isDirectory(), true);
    assert.equal(fs.existsSync(workspace), false);
    assert.notEqual(project, getProjectDir(`${workspace}-other`));
    assert.equal(process.env.RYUGI_CLI_PATH, originalCli);
    assert.equal(process.env.RYUGI_SERVER_HOME, originalHome);
    assert.ok(Buffer.byteLength(runtime.socketPath) < 104);
    assert.equal(getPrivateRuntime().env.RYUGI_RUNTIME_DIR, socketDir);
    fs.writeFileSync(path.join(dir, "node_modules/ryugi-artifacts/package.json"), JSON.stringify({ version: "0.0.0" }));
    assert.throws(getPrivateRuntime, /npm run setup:runtime/);
    fixture(dir);
    fs.rmSync(path.join(dir, "workflow/skills/artifacts/SKILL.md"));
    assert.throws(getPrivateRuntime, /未就绪/);
    fixture(dir);
    fs.writeFileSync(path.join(dir, "runtime.json"), JSON.stringify({ workflowCommit: "other" }));
    assert.throws(getPrivateRuntime, /未就绪/);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previous === undefined) delete process.env.PASEO_RYUGI_RUNTIME_DIR;
    else process.env.PASEO_RYUGI_RUNTIME_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
    if (socketDir) fs.rmSync(socketDir, { recursive: true, force: true });
  }
});

test("安装固定版本，禁用 npm scripts/git hooks，并可重复执行", async () => {
  const { setupRuntime } = await import("../scripts/setup-runtime.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-setup-test-"));
  const calls = [];
  let checkedOut = false;
  const run = (command, args) => {
    calls.push({ command, args });
    if (command === "npm") {
      fixture(dir);
      fs.rmSync(path.join(dir, "runtime.json"));
    } else {
      assert.deepEqual(args.slice(0, 4), ["-c", "core.hooksPath=/dev/null", "-C", path.join(dir, "workflow")]);
      if (args.includes("init")) fs.mkdirSync(path.join(dir, "workflow/.git"));
      if (args.includes("checkout")) checkedOut = true;
      if (args.includes("rev-parse")) {
        if (!checkedOut) throw new Error("missing HEAD");
        return `${RYUGI_WORKFLOW_COMMIT}\n`;
      }
    }
    return "";
  };
  try {
    assert.equal(setupRuntime({ runtimeDir: dir, run }), dir);
    assert.deepEqual(calls.find((call) => call.command === "npm").args, ["ci", "--prefix", dir, "--ignore-scripts", "--no-audit", "--no-fund"]);
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"));
    assert.equal(lock.packages["node_modules/ryugi-artifacts"].version, RYUGI_VERSION);
    assert.match(lock.packages["node_modules/ryugi-artifacts"].integrity, /^sha512-/);
    assert.ok(calls.some((call) => call.args.includes("fetch") && call.args.includes(RYUGI_WORKFLOW_COMMIT)));
    const before = calls.length;
    setupRuntime({ runtimeDir: dir, run });
    assert.deepEqual(calls.slice(before).map((call) => call.args.slice(4)), [["rev-parse", "HEAD"]]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "runtime.json"))).workflowCommit, RYUGI_WORKFLOW_COMMIT);
    fs.rmSync(path.join(dir, "workflow/skills/artifacts/SKILL.md"));
    assert.throws(() => setupRuntime({ runtimeDir: dir, run }), /缺少 artifacts skill/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("手动更新同时启用新 CLI 和工作流，并保留原有工件及服务状态", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-update-test-"));
  const previous = process.env.PASEO_RYUGI_RUNTIME_DIR;
  const release = "1.200.0";
  let socketDir;
  let breakWorkflow = true;
  let publishedVersion = release;
  let installs = 0;
  const run = async (command, args, cwd) => {
    if (command === "npm" && args[0] === "view") return JSON.stringify(publishedVersion);
    if (command === "npm") {
      installs++;
      assert.ok(args.includes(`ryugi-artifacts@${release}`));
      assert.ok(args.includes("--ignore-scripts"));
      fixture(cwd);
      fs.writeFileSync(path.join(cwd, "node_modules/ryugi-artifacts/package.json"), JSON.stringify({ version: release }));
      assert.equal(getPrivateRuntime().version, "1.108.1", "安装期间继续使用旧版本");
    } else if (args.includes("fetch")) {
      assert.ok(args.includes(`refs/tags/v${release}`));
      if (breakWorkflow) throw new Error("fetch failed");
    }
    return "";
  };
  try {
    fixture(dir);
    process.env.PASEO_RYUGI_RUNTIME_DIR = dir;
    const original = getPrivateRuntime();
    socketDir = original.env.RYUGI_RUNTIME_DIR;
    assert.equal(original.version, "1.108.1");
    const { updatePrivateRuntime } = require("../server/runtimeUpdate.ts");
    const workspace = path.join(dir, "workspace");
    const project = original.getProjectDir(workspace);
    const artifact = path.join(project, "existing.txt");
    fs.writeFileSync(artifact, "original artifact");

    await assert.rejects(updatePrivateRuntime(dir, new AbortController().signal, run), /fetch failed/);
    assert.equal(getPrivateRuntime().cliPath, original.cliPath);
    assert.deepEqual(fs.readdirSync(path.join(dir, "releases")), []);

    breakWorkflow = false;
    assert.equal(await updatePrivateRuntime(dir, new AbortController().signal, run), "updated");
    const updated = getPrivateRuntime();
    assert.equal(updated.version, release);
    assert.equal(updated.cliPath, path.join(dir, "releases", release, "node_modules/ryugi-artifacts/dist/cli.cjs"));
    assert.equal(updated.skillsDir, path.join(dir, "releases", release, "workflow/skills"));
    assert.equal(updated.serverHome, original.serverHome);
    assert.equal(updated.socketPath, original.socketPath);
    assert.equal(updated.getProjectDir(workspace), project);
    assert.equal(fs.readFileSync(artifact, "utf8"), "original artifact");
    assert.ok(fs.existsSync(original.cliPath), "已打开的会话仍可使用原运行时");

    assert.equal(await updatePrivateRuntime(dir, new AbortController().signal, run), "current");
    publishedVersion = "1.108.1";
    assert.equal(await updatePrivateRuntime(dir, new AbortController().signal, run), "current");
    assert.equal(installs, 2);
    assert.equal(getPrivateRuntime().version, release);
  } finally {
    if (previous === undefined) delete process.env.PASEO_RYUGI_RUNTIME_DIR;
    else process.env.PASEO_RYUGI_RUNTIME_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
    if (socketDir) fs.rmSync(socketDir, { recursive: true, force: true });
  }
});
