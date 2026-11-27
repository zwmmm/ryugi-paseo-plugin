import fs from "node:fs";
import path from "node:path";
import { artifactFiles } from "../shared/artifacts.js";

const watchedFiles = new Set<string>([...Object.values(artifactFiles), "comments.json", ".artifact-id"]);
const stores = [".artideck", ".ryugi"] as const;

export function watchArtifacts(projectDir: string, onChange: () => void) {
  const targets = [
    {
      dir: projectDir,
      recursive: false,
      matches: (_event: string, file?: string) => !file || stores.includes(file.split(/[\\/]/)[0] as (typeof stores)[number]),
    },
    ...stores.flatMap((store) => {
      const storeDir = path.join(projectDir, store);
      const artifactsDir = path.join(storeDir, "artifacts");
      return [
        {
          dir: storeDir,
          recursive: false,
          matches: (_event: string, file?: string) => !file || file.split(/[\\/]/)[0] === "artifacts",
        },
        {
          dir: artifactsDir,
          recursive: true,
          matches: (event: string, file?: string) => {
            if (file && file.split(/[\\/]/)[0] === ".state") return false;
            if (event !== "rename" && file && !watchedFiles.has(file.split(/[\\/]/).at(-1)!)) return false;
            return true;
          },
        },
      ];
    }),
  ];
  const watchers: Array<fs.FSWatcher | undefined> = [];
  const inodes: Array<number | undefined> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const statIno = (dir: string) => {
    try { return fs.statSync(dir).ino; } catch { return undefined; }
  };

  const refresh = (from: number) => {
    for (let index = from; index < targets.length; index++) {
      const target = targets[index];
      const nextIno = statIno(target.dir);
      if (watchers[index] && nextIno === inodes[index]) continue;
      watchers[index]?.close();
      watchers[index] = undefined;
      inodes[index] = undefined;
      try {
        const watcher = fs.watch(target.dir, { recursive: target.recursive }, (event, name) => {
          if (closed || watchers[index] !== watcher) return;
          if (!target.matches(event, name?.toString())) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            refresh(0);
            onChange();
          }, 150);
        });
        watchers[index] = watcher;
        inodes[index] = nextIno;
        watcher.on("error", (error) => {
          if (watchers[index] !== watcher) return;
          watcher.close();
          watchers[index] = undefined;
          inodes[index] = undefined;
          console.error("[Artideck] 文件监听失败", error);
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") console.error("[Artideck] 文件监听失败", error);
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
