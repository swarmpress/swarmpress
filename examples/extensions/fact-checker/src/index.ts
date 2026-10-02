/**
 * Fact-check desk: a skill with one tool and one job.
 *
 * - tool `extract_claims`: splits text into checkable sentences (ones with a
 *   number or a capitalised name after the first word);
 * - job `fact-check`: fetches a Wikipedia summary per claim (web capability,
 *   only https://en.wikipedia.org), asks the low-tier model for a verdict, keeps
 *   the report in the `factchecks` store table, and returns an artifact plus a
 *   digest. It never approves, publishes or changes a stage.
 */
import { defineSkill, jobResult } from "@simpress/sdk/runtime";

interface Claim {
  text: string;
  /** Wikipedia page title to check against. */
  source: string;
}

type Verdict = "supported" | "contradicted" | "unverifiable";

export function extractClaims(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && (/\d/.test(s) || /\s[A-Z][a-z]/.test(s)));
}

function parseVerdict(answer: string): Verdict {
  const a = answer.trim().toUpperCase();
  if (a.startsWith("SUPPORTED")) return "supported";
  if (a.startsWith("CONTRADICTED")) return "contradicted";
  return "unverifiable";
}

export default defineSkill({
  tools: {
    extract_claims: {
      description: "Splits a text into sentences worth fact-checking.",
      input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      run: (input: { text: string }) => ({ claims: extractClaims(input.text) }),
    },
  },
  jobs: {
    "fact-check": {
      description: "Checks each claim against its Wikipedia summary; defects are contradicted or unverifiable claims.",
      example: {
        input: {
          page_id: "vernazza-guide",
          claims: [{ text: "Vernazza is one of the five villages of the Cinque Terre.", source: "Vernazza" }],
        },
        llm: ["SUPPORTED: the summary lists Vernazza among the Cinque Terre."],
      },
      async handler({ job, web, llm, store, log }) {
        const { page_id, claims } = job.input as { page_id: string; claims: Claim[] };
        const results: Array<{ claim: string; source: string; verdict: Verdict; reason: string }> = [];
        for (const c of claims) {
          const url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(c.source);
          const res = await web.fetch(url, { headers: { accept: "application/json" } });
          if (!res.ok) {
            results.push({ claim: c.text, source: url, verdict: "unverifiable", reason: `source returned ${res.status}` });
            continue;
          }
          const summary = ((await res.json()) as { extract?: string }).extract ?? "";
          const answer = await llm.complete({
            tier: "low",
            system: "You are a careful fact-checker. Answer SUPPORTED, CONTRADICTED or UNVERIFIABLE, then a colon and one short reason.",
            prompt: `Claim: ${c.text}\nSource (${c.source}): ${summary}`,
          });
          const verdict = parseVerdict(answer.text);
          results.push({ claim: c.text, source: url, verdict, reason: answer.text.replace(/^[A-Z]+:\s*/, "") });
        }
        const defects = results.filter((r) => r.verdict !== "supported").length;
        log.info(`checked ${results.length} claim(s) on ${page_id}: ${defects} defect(s)`);
        const artifact = { kind: "fact-check-report", content: { page_id, results } };
        await store.table("factchecks").put(page_id, artifact.content);
        return jobResult(artifact, {
          ok: defects === 0,
          score: Math.max(0, 10 - 3 * defects),
          qa_defects: defects,
          words: results.reduce((n, r) => n + r.claim.split(/\s+/).length, 0),
        });
      },
    },
  },
});
