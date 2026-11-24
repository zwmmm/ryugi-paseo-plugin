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
