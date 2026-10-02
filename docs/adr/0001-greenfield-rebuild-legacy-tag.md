# ADR-0001 — Greenfield rebuild, legacy tag

**Status:** Accepted
**Date:** 2026-10-01

## Context

The TypeScript swarm.press (Temporal, NATS + JetStream, a transactional outbox, tRPC, an Astro
admin, eleven agents on the Claude Agent SDK) never ran reliably. Exactly one article went live
autonomously (2026-05-12, `/en/blog/last-light-on-sentiero-azzurro/`), and only after about
fifteen runtime fixes: workflow determinism, outbox draining, state-audit columns, NATS start-up
order and a block-shape normaliser. The infrastructure was far heavier than the job needed, and
every fix exposed the next integration seam.

The product direction has also changed. swarm.press becomes **swarm.press**, a management game in
which the publishing house is a visible isometric building and the staff are agents. That needs
a deterministic simulation, a real-time renderer and a server-authoritative multiplayer model,
and the old stack has no place for any of them.

What is worth keeping is conceptual, not code:
- the organisation and RBAC;
- QuestionTickets as the only channel to the CEO;
- the content and ticket state machines;
- JSON block pages with `LocalizedString`, stored repo-canonically;
- the editor rubric (approve at 7 or above);
- the personas and the style guide;
- the 3-level prompt layering;
- closed-world knowledge indexes;
- the page pipeline with a hard QA gate.

There is also one hard constraint: the live **cinqueterre.travel** deploy still checks out this
monorepo and builds `packages/site-builder/src/themes/cinque-terre`.

## Decision

Rebuild from a fresh tree in `swarmpress/swarmpress`, on branch `claude/simpress-babylon`.

- `main` is tagged **`legacy-ts`**. It is also tagged **`legacy-final`**, the ref the live deploy
  pins to (see [ADR-0023](0023-cinqueterre-migration-and-cutover.md)). Legacy sources stay
  readable through git history. Nothing is ported file by file.
- The fresh tree deletes everything except three things the live site needs: the frozen theme
  path, its pnpm workspace entry, and the lockfile entries it depends on. That path stays
  byte-identical until cutover step 0 or 1 lands.
- Concepts carry over by being re-specified in `docs/` and the ADRs, naming the legacy file as
  the reference where that helps.
- `main` is replaced by a normal merge commit, never a force-push, after a search for other
  repositories that check it out.

Alternatives considered:

- **Repair the TypeScript stack.** Rejected. Each repair so far uncovered another seam. The
  operational weight (Temporal, NATS, outbox) would stay, and none of it serves a game.
- **New repository.** Rejected. The issue history and the GitHub org wiring would have to move at
  once, and so would the live site's checkout of `swarmpress/swarmpress`, which matters most.
- **Incremental strangler inside the old tree.** Rejected. The two architectures share almost no
  runtime, so a strangler would mean running both stacks for months.

## Consequences

- Positive: one coherent architecture (Rust server and sim, a wasm client, Postgres only), no
  dead code to reason about, and docs and ADRs that start in step with the code.
- Positive: legacy behaviour stays auditable via `git show legacy-ts:<path>`.
- Negative: everything that worked, including the one proven autonomous chain, must be earned and
  tested again. For a long period the new tree publishes nothing.
- Negative: until cutover step 0 lands, the frozen theme path constrains every commit to `main`.
  CI keeps a frozen-theme build job to protect it.
- The `legacy-ts` and `legacy-final` tags must be pushed before the fresh tree reaches `main`.
