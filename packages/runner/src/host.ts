/**
 * The runner's only contact with the OS: a thin file shim (ADR-0042: web-standard
 * APIs plus a `Bun.file` shim, so the runner also runs under Node 22+).
 */
import { mkdir, readdir, readFile, stat, writeFile as nodeWrite } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

declare const Bun: { file(p: string): { arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> } } | undefined;

export const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export async function readBytes(path: string): Promise<Uint8Array> {
  if (isBun) return new Uint8Array(await Bun!.file(path).arrayBuffer());
  return new Uint8Array(await readFile(path));
}

export async function readText(path: string): Promise<string> {
  if (isBun) return Bun!.file(path).text();
  return readFile(path, "utf8");
}

export async function writeFile(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await nodeWrite(path, data);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

const SKIP = new Set(["node_modules", "dist", "reports", ".git"]);

/** Every file under `root` (relative, `/`-separated, sorted), skipping build output and dot dirs. */
export async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(relative(root, p).split(sep).join("/"));
    }
  };
  await walk(root);
  return out.sort();
}

/** Lower-case hex SHA-256 via WebCrypto (Bun, Node, browsers). */
export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
