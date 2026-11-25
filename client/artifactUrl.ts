export async function canOpenLocally(probeUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(probeUrl, { signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error" });
    return response.ok && await response.text() === probeUrl.slice(probeUrl.lastIndexOf("/") + 1);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
