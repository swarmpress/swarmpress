# ADR-0058 — Staged jobs on one resident model

**Status:** Accepted (amends ADR-0011 and ADR-0024; refines ADR-0056)
**Date:** 2026-10-02

## Context

The Draft job asks the model for a whole page in one structured call with a 16,000-token output
budget. The resident model of ADR-0057 works in an 8–16K context, reasons at length before
answering and has no constrained decoding. One call cannot fit, a truncated answer fails the
whole job, and a repair turn that resends the previous output overflows the context.

Today a reload re-runs a job's model calls and duplicates its plan posts, and nothing records
who did what, with which model, in how long.

Detail: [`docs/design/mvp-pipeline.md`](../design/mvp-pipeline.md) sections 1 and 8.

## Decision

1. **Stages are sub-steps inside the existing Draft and Review jobs.** The sim still owns
   Draft → Review → Publish (ADR-0011); stages only produce artifacts. No sim change and no
   golden change.
2. **Draft stages:** context (no model) → outline → one section at a time → closing → assemble
   → validate → a fix for the failing section only → commit. Each model call fits the context
   and returns a few hundred to about 1,000 tokens.
3. **The model writes text; the orchestrator writes structure.** Schemas are flat (no `anyOf`).
   Headings, hero, images, closing block and `seo` are assembled deterministically.
4. **Repair policy:** per-section checks before the next section starts; at most 2 repairs per
   section and 4 per job; a truncated section is retried split in two; an unchanged section
   after a fix stops the loop. Repair turns carry only the stripped answer, never the reasoning.
5. **Revisions patch.** The editor's issues are tagged by section; a revision rewrites only the
   named sections and leaves the rest byte-identical.
6. **Review stays within context.** The editor reads text with section markers and the measured
   checks, in one call when short and section by section when long.
7. **Stage results are stored** by (company, job, stage, index), first write wins, with an input
   hash. A reload, a failed stage or a retried phase never repeats a completed call. Plan posts
   carry a dedupe key.
8. **Progress is reported as counts**, for example "writing section 3 of 5". No percentages.
9. **A lean activity record** is written per stage attempt and per job (staff, role, model,
   tokens, wall time, game step, result, references), shaped so the work records of ADR-0056 can
   absorb it.
10. **Commit attribution narrows ADR-0056 decision 8:** the persona is the author of draft-branch
    commits; the squash commit keeps the platform as author and carries `Co-authored-by` and
    provenance trailers, because the merge API has no author field.

Nothing here is built. Increments P2, P3, P5 and G6 of `docs/mvp.md` implement it.

## Consequences

- An article can be finished by a bounded, slow local model, and a failure costs one section.
- The office can show what each person is doing, and the Activity timeline has data.
- Jobs become resumable: a hidden tab, a lost GPU device or a reload loses no completed work.
- **Negative:**
  - More model calls per article (an outline, five or so sections, a closing, a review), so
    wall time per article rises; ADR-0060 keeps game time unaffected.
  - Section-by-section writing can lose the thread. A short digest of earlier sections and the
    previous section's last paragraph are passed forward; the editor still reads the whole.
  - A second store migration (`job_stages`, post dedupe, `activity`).
  - The post dedupe key is temporary: atomic record commit (ADR-0056) replaces it.
- **Alternatives rejected:**
  - *One sim job kind per stage.* It would put a text-derived number into the sim, add about ten
    commands per article and tie game time to stage count.
  - *Keeping the single call with a larger context.* It does not fit the model's working
    context, and one truncation fails the whole article.
  - *A file-tool agent editing page JSON by patches.* Suitable for themes later; for articles the
    section is the natural unit and needs no tool loop.
