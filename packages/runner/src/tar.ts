/**
 * Minimal deterministic ustar writer plus gzip (web `CompressionStream`), for
 * `simpress pack`. Entries are sorted, mtimes are 0 and owners are empty, so
 * the same files always give the same tar bytes.
 */

const enc = new TextEncoder();

function field(buf: Uint8Array, off: number, len: number, value: string): void {
  const b = enc.encode(value);
  if (b.length > len) throw new Error(`tar: field too long: ${value}`);
  buf.set(b, off);
}

function octal(buf: Uint8Array, off: number, len: number, n: number): void {
  field(buf, off, len, n.toString(8).padStart(len - 1, "0") + "\0");
}

function header(name: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  let prefix = "";
  let base = name;
  if (enc.encode(name).length > 100) {
    const cut = name.lastIndexOf("/", 155);
    if (cut <= 0 || enc.encode(name.slice(cut + 1)).length > 100) throw new Error(`tar: path too long: ${name}`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  field(h, 0, 100, base);
  octal(h, 100, 8, 0o644);
  octal(h, 108, 8, 0);
  octal(h, 116, 8, 0);
  octal(h, 124, 12, size);
  octal(h, 136, 12, 0);
  h.fill(0x20, 148, 156); // checksum placeholder (spaces)
  h[156] = 0x30; // '0' regular file
  field(h, 257, 6, "ustar\0");
  field(h, 263, 2, "00");
  field(h, 345, 155, prefix);
  let sum = 0;
  for (const b of h) sum += b;
  field(h, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

export function tar(files: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    parts.push(header(f.path, f.data.length), f.data);
    const pad = (512 - (f.data.length % 512)) % 512;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads a (gunzipped) tar back into path → bytes (tests). */
export function untar(data: Uint8Array): Map<string, Uint8Array> {
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let o = 0;
  while (o + 512 <= data.length) {
    const h = data.subarray(o, o + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a: number, l: number) => dec.decode(h.subarray(a, a + l)).replace(/\0.*$/s, "");
    const name = str(0, 100);
    const prefix = str(345, 155);
    const size = parseInt(str(124, 12).trim(), 8);
    o += 512;
    out.set(prefix ? `${prefix}/${name}` : name, data.slice(o, o + size));
    o += Math.ceil(size / 512) * 512;
  }
  return out;
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
