/**
 * Ghost publisher (a publish target, ADR-0043).
 *
 * - openDraft: page JSON → HTML → `POST /ghost/api/admin/posts/?source=html` as a draft;
 * - merge: publish it (`PUT …/posts/{id}/` with `status: published` and the
 *   `updated_at` we drafted, Ghost's optimistic-concurrency token = our headSha);
 * - status: `GET …/posts/{id}/` → open | deployed.
 *
 * The Admin API key never enters the sandbox: requests carry the opaque
 * credential reference, and the host's credential proxy adds the
 * `Authorization: Ghost <token>` header outside.
 *
 * Only headings, paragraphs, lists and quotes are mapped. Any other block
 * fails the draft loudly instead of being dropped. Text is escaped, never
 * parsed as Markdown.
 */
import { definePublishTarget } from "@simpress/sdk/runtime";

const ORIGIN = "https://demo.ghost.io";
const API = ORIGIN + "/ghost/api/admin";
const HEADERS = { "content-type": "application/json", "accept-version": "v5.0" };

type Block =
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "paragraph"; markdown: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string; attribution?: string }
  | { type: string; [k: string]: unknown };

interface Page {
  id: string;
  slug: { en: string };
  title: { en: string };
  body: Block[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function pageToHtml(page: Page): string {
  return page.body
    .map((b) => {
      switch (b.type) {
        case "heading": {
          const h = b as Extract<Block, { type: "heading" }>;
          return `<h${h.level}>${esc(h.text)}</h${h.level}>`;
        }
        case "paragraph":
          return `<p>${esc((b as { markdown: string }).markdown)}</p>`;
        case "list": {
          const l = b as { ordered: boolean; items: string[] };
          const tag = l.ordered ? "ol" : "ul";
          return `<${tag}>${l.items.map((i) => `<li>${esc(i)}</li>`).join("")}</${tag}>`;
        }
        case "quote": {
          const q = b as { text: string; attribution?: string };
          return `<blockquote><p>${esc(q.text)}</p>${q.attribution ? `<cite>${esc(q.attribution)}</cite>` : ""}</blockquote>`;
        }
        default:
          throw new Error(`ghost-publisher: block type "${b.type}" is not supported yet`);
      }
    })
    .join("\n");
}

interface GhostPost {
  id: string;
  uuid: string;
  status: "draft" | "published" | "scheduled";
  updated_at: string;
}

async function ghost(res: { ok: boolean; status: number; json<T>(): Promise<T>; text(): Promise<string> }): Promise<GhostPost> {
  if (!res.ok) throw new Error(`Ghost Admin API returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json<{ posts: GhostPost[] }>()).posts[0];
}

export default definePublishTarget({
  async openDraft(input, { web }) {
    const page = input.page as Page;
    const post = {
      title: page.title.en,
      slug: page.slug.en,
      html: pageToHtml(page),
      status: "draft",
      custom_excerpt: input.message.slice(0, 300),
      tags: [{ name: "#simpress" }],
    };
    const p = await ghost(
      await web.fetch(`${API}/posts/?source=html`, { method: "POST", headers: HEADERS, body: JSON.stringify({ posts: [post] }) }),
    );
    return { ref: p.id, headSha: p.updated_at, previewUrl: `${ORIGIN}/p/${p.uuid}/` };
  },
  async merge(input, { web }) {
    const p = await ghost(
      await web.fetch(`${API}/posts/${input.ref}/`, {
        method: "PUT",
        headers: HEADERS,
        body: JSON.stringify({ posts: [{ status: "published", updated_at: input.headSha }] }),
      }),
    );
    return { mergedSha: p.updated_at };
  },
  async status(input, { web }) {
    const p = await ghost(await web.fetch(`${API}/posts/${input.ref}/`, { headers: HEADERS }));
    return { state: p.status === "published" ? "deployed" : "open" };
  },
});
