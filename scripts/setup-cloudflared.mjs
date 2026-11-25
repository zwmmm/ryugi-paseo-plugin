import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const version = "2026.11.1";
const assets = {
  "darwin-x64": ["darwin-amd64.tgz", "5e0403b188dfee71fbd9b995e7dc9910d61b661c52371935ab6475d41185632f"],
  "darwin-arm64": ["darwin-arm64.tgz", "02fe4bcf08f2c09699cff30658228a739a0c47fb75f3653d1b8772a27ade4462"],
  "linux-x64": ["linux-amd64", "97bb3b02d23a5980fc9c15a1a270e692da1923f103f920d5b16d4931d5ab55e7"],
  "linux-arm64": ["linux-arm64", "b155cec3e48e489cfb8e5c602769fb8c771083018d8881d68b4d18a791567c5a"],
  "win32-x64": ["windows-amd64.exe", "341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35"],
};

export async function setupCloudflared(runtimeDir) {
  const asset = assets[`${process.platform}-${process.arch}`];
  if (!asset) {
    console.warn(`TryCloudflare is unavailable on ${process.platform}/${process.arch}.`);
    return;
  }
  const directory = path.join(runtimeDir, "bin");
  const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const destination = path.join(directory, name);
  try {
    if (execFileSync(destination, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).includes(`cloudflared version ${version} `)) return;
  } catch {}
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = await fs.mkdtemp(path.join(directory, ".cloudflared-"));
  try {
    const [filename, digest] = asset;
    const url = `https://github.com/cloudflare/cloudflared/releases/download/${version}/cloudflared-${filename}`;
    const download = path.join(temporary, "download");
    if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy) {
      await run("curl", ["--fail", "--location", "--silent", "--show-error", "--max-time", "120", "--output", download, url]);
    } else {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`cloudflared download returned HTTP ${response.status}`);
      await fs.writeFile(download, Buffer.from(await response.arrayBuffer()));
    }
    const bytes = await fs.readFile(download);
    if (createHash("sha256").update(bytes).digest("hex") !== digest) throw new Error("cloudflared SHA-256 mismatch");
    const binary = path.join(temporary, name);
    if (filename.endsWith(".tgz")) {
      execFileSync("tar", ["-xzf", download, "-C", temporary, "cloudflared"]);
    } else {
      await fs.rename(download, binary);
    }
    await fs.chmod(binary, 0o755);
    await fs.rename(binary, destination);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
