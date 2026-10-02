# ADR-0010 — Claude over raw HTTP; per-role model and effort; structured outputs; refusal policy

**Status:** Accepted
**Date:** 2026-10-01

## Context

The legacy agents used the Claude Agent SDK from Node. swarm.press's server is Rust, and agent work
must be observable and testable at the HTTP level. That means:
- streaming tokens into speech bubbles;
- tool loops;
- prompt caching;
- usage accounting per company;
- deterministic tests with a fake.

The roles also differ a lot in difficulty. An Editor-in-Chief or an Art Director with vision is
very different from a media tagger.

## Decision

- **`crates/claude`** is our own client for the Messages API over `reqwest`. It supports:
  - SSE streaming, with a parser that handles `text`, `tool_use`, `thinking`, `refusal`,
    `max_tokens` and fallback blocks;
  - the tool-use loop;
  - structured outputs (JSON Schema);
  - `cache_control` placement on the stable prompt prefix (company → site → persona);
  - retry with jitter on 429, 529 and `overloaded_error`;
  - usage capture into an `llm_calls` audit table (tokens, cost, latency, company, job).
- **Per-role defaults live in `config/roles.toml`:**

  | Role | Model | Effort / extras |
  |---|---|---|
  | Editor-in-Chief | opus-5-5 | high |
  | Writer, Editor | opus-5-5 | medium |
  | Art Director, Front-end Dev | opus-5-5 | high, vision |
  | SEO, Linker, Researcher | sonnet-5-5 | web_search |
  | Media | haiku-4-5 | |
  | Chatter | sonnet-5-5 | low |

  A staff member's seniority overrides the model: Junior → haiku-4-5, Mid → sonnet-5-5,
  Senior/Star → opus-5-5. Since [ADR-0024](0024-hybrid-inference-browser-llms-and-claude.md), this
  table applies to **Claude/Agency jobs**. Staff jobs run on the local model tier.
- **No forced `tool_choice`.** Structured results come from a schema-constrained final answer, and
  request snapshots test this.
- **Refusal policy.**
  - A `refusal` stop reason, or an output that fails validation after N repair turns, **fails the
    job loudly**.
  - The stage blocks and a ticket opens. The job is never silently retried with a weaker prompt.
  - Fallback content is never invented.
- There is **no API cost cap** by product decision. Costs are recorded and shown, never enforced.

Alternatives considered:

- **The Claude Agent SDK via a Node sidecar.** Rejected. It adds a second runtime, and tests and
  streaming are harder to control.
- **A community Rust SDK.** Rejected. Lagging feature coverage (refusal blocks, fallback, effort),
  and we need fine control over SSE for bubbles.
- **One model for everything.** Rejected. Cost and latency would be poor for small roles, and
  promotions would mean nothing.

## Consequences

- Positive: the HTTP layer can be fully faked (`FakeClaude` in `crates/testkit`) with scripted
  SSE transcripts, so pipelines are tested deterministically.
- Positive: a promotion really changes output quality, which is a game mechanic.
- Negative: we maintain API compatibility ourselves when the API evolves. Fixture-based parser
  tests detect breaking changes.
- Negative: uncapped spend needs strong visibility. `llm_calls` is surfaced in operations
  dashboards and in-game as "Agency invoices".
