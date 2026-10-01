# ADR-0014 — Content model: JSON blocks, LocalizedString, core plus custom block schemas

**Status:** Accepted
**Date:** 2026-10-01

## Context

Pages must be:
- machine-writable by LLMs;
- validated before they land;
- renderable by any theme;
- multilingual.

The legacy content model already used JSON blocks and `LocalizedString` (`en` required), and it
worked. Its schema, though, lived only in Zod, and the Rust side had nothing.

Agent-authored themes ([ADR-0015](0015-agent-authored-themes-on-site-kit.md)) need to add their
own blocks without forking the platform schema.

## Decision

- **A page** is `{ id, slug: LocalizedString, title: LocalizedString, page_type, seo, body:
  Block[], status, timestamps }`. Collections are stored as per-region arrays.
- **`LocalizedString`** requires `en`, the fallback locale. Schema v2 (cutover step 5) generalises
  text fields to `string | Partial<Record<Lang, string>>`. Values are always read through
  `localize()` / `getLocalizedValue()`, never with `v[locale] || v.en`.
- **Blocks are discriminated by `type`.**
  - **Core blocks** are platform-owned and versioned with the site kit.
  - **Custom blocks** are namespaced `x:<name>` and defined in the site repo under
    `theme/blocks/<name>/schema.json`.
  - Block metadata covers intent, media rules and linking rules. It is carried over from
    `legacy/packages/shared/src/content/block-metadata.ts`.
- **One schema, two validators.**
  - The Zod schema in `packages/content-schema` exports `page.schema.json`
    (`pnpm schema:export`).
  - The Rust crate (`crates/content-schema` today, `crates/content-model` from M3) embeds the
    committed JSON Schema and validates with `jsonschema`.
  - Shared fixtures (`fixtures/valid`, `fixtures/invalid`) must agree in both. CI fails on schema
    drift.
- **Writer block documentation in prompts is generated from the schemas** (core plus the site's
  custom schemas), never hand-written.
- **Renderers never parse Markdown at render time.** Inline emphasis lives in structured
  sub-blocks.

Alternatives considered:

- **Markdown or MDX.** Rejected. It is hard to validate, invites render-time parsing, and themes
  can't own presentation.
- **Rust as the schema source (schemars) with a generated Zod mirror.** Deferred. Zod is the
  existing source, and the site kit is TypeScript. The direction may flip at schema v2, and the
  conformance tests make the direction irrelevant to correctness.
- **Free-form custom blocks without schemas.** Rejected. Writers couldn't be told about them, and
  validation would be impossible.

## Consequences

- Positive: the same validator runs in the browser (wasm), on the server and in site CI.
- Positive: themes can extend the vocabulary safely.
- Negative: two validator implementations must be kept in agreement, which conformance fixtures
  handle.
- Negative: schema evolution needs codemods (`kit migrate`) and a ratcheting `kit check
  --baseline` for existing content.
