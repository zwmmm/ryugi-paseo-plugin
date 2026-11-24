import fs from "node:fs";
import path from "node:path";

export function watchArtifacts(projectDir: string, onChange: () => void) {
  const ryugiDir = path.join(projectDir, ".ryugi");
  const directories = [projectDir, ryugiDir, path.join(ryugiDir, "artifacts")];
  const children = [".ryugi", "artifacts"];
  const watchers: Array<fs.FSWatcher | undefined> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const refresh = (from: number) => {
    for (let index = from; index < directories.length; index++) {
      watchers[index]?.close();
      watchers[index] = undefined;
      const recursive = index === children.length;
      try {
        const watcher = fs.watch(directories[index], { recursive }, (event, name) => {
          if (closed || watchers[index] !== watcher) return;
          const file = name?.toString();
          if (recursive) {
            if (file && (file === ".state" || file.startsWith(`.state${path.sep}`))) return;
            if (event !== "rename" && file && !/(^|[\\/])(comments\.json|canvas\.json|doc\.xml|\.artifact-id)$/.test(file)) return;
          } else {
            if (file && file.split(/[\\/]/)[0] !== children[index]) return;
          }
          clearTimeout(timer);
          timer = setTimeout(() => {
            refresh(0);
            onChange();
          }, 150);
        });
        watchers[index] = watcher;
        watcher.on("error", (error) => {
          if (watchers[index] !== watcher) return;
          watcher.close();
          watchers[index] = undefined;
          console.error("[Ryugi] 文件监听失败", error);
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") console.error("[Ryugi] 文件监听失败", error);
      }
    }
  };

  refresh(0);
  return () => {
    closed = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher?.close();
  };
}
