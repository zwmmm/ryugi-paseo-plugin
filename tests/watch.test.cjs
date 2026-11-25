const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");
const { watchArtifacts } = require("../server/watchArtifacts.ts");

test("目录删除和重建后仍能通知评论变化，停止后释放监听", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-watch-"));
  const ryugi = path.join(dir, ".ryugi");
  const artifacts = path.join(ryugi, "artifacts");
  const artifact = path.join(artifacts, "artboard", "login");
  const comments = path.join(artifact, "comments.json");
  let notifications = 0;
  let notify;
  const stop = watchArtifacts(dir, () => {
    notifications++;
    notify?.();
  });

  const waitForChange = async (change) => {
    let timeout;
    const changed = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("未收到工件变化通知")), 3000);
      notify = resolve;
    });
    try {
      change();
      await changed;
    } finally {
      clearTimeout(timeout);
      notify = undefined;
    }
  };

  try {
    await waitForChange(() => fs.mkdirSync(artifact, { recursive: true }));
    await waitForChange(() => fs.writeFileSync(comments, '{"threads":[]}'));
    await waitForChange(() => fs.rmSync(artifacts, { recursive: true }));
    await waitForChange(() => fs.mkdirSync(artifact, { recursive: true }));
    await waitForChange(() => fs.writeFileSync(comments, '{"threads":["replacement"]}'));
    await waitForChange(() => fs.rmSync(ryugi, { recursive: true }));
    await waitForChange(() => fs.mkdirSync(artifact, { recursive: true }));
    await waitForChange(() => fs.writeFileSync(comments, '{"threads":["recreated"]}'));

    stop();
    const before = notifications;
    fs.writeFileSync(comments, '{"threads":["after stop"]}');
    await delay(300);
    assert.equal(notifications, before);
  } finally {
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("所有工件主文件的内容修改都会刷新入口，忽略服务状态文件", async (t) => {
  const { EventEmitter } = require('node:events');
  const callbacks = new Map();
  t.mock.method(fs, 'watch', (dir, options, callback) => {
    const watcher = new EventEmitter();
    watcher.close = () => {};
    callbacks.set(dir, callback);
    return watcher;
  });
  let notifications = 0;
  const stop = watchArtifacts('/project', () => { notifications++; });
  try {
    const files = ['document/a/doc.xml', 'artboard/a/canvas.json', 'html/a/index.html', 'slides/a/index.html', 'whiteboard/a/scene.excalidraw', 'verify/a/verify.xml', 'report/a/report.tsx', 'storyboard/a/storyboard.xml'];
    for (let i = 0; i < files.length; i++) {
      callbacks.get('/project/.ryugi/artifacts')('change', files[i]);
      await delay(200);
      assert.equal(notifications, i + 1, files[i]);
    }
    callbacks.get('/project/.ryugi/artifacts')('change', '.state/snapshot.json');
    await delay(200);
    assert.equal(notifications, files.length);
  } finally { stop(); }
});
