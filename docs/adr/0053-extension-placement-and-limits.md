# ADR-0053 — Extension placement and limits

**Status:** Accepted (amends ADR-0042 and ADR-0043)
**Date:** 2026-10-02

## Context

ADR-0042 says extensions are JavaScript bundles that run in a wasm sandbox, client-side, and
rejects server-hosted mods as contrary to local-first. ADR-0048 now lets a runner continue a
company while the browser is closed, self-hosted or managed. That runner is the same host with
the same QuickJS sandbox (rule 14), so an extension may run there too. The manifest has no way
to say whether it should.

The manifest (`packages/sdk/src/schemas.ts`) is strict. Its capabilities are `web`, `credits`,
`ui`, `llm:low|mid|high|agency` and `store:<table>`. LLM tiers name a capability level, not a
location: nothing says whether `llm:low` is served by a local model or a cloud one. A runner has
no GPU, so on a runner every LLM tier would be a paid cloud call.

Managed execution costs real money (ADR-0044), so an install needs a cost figure the player can
trust. A self-declared cost hint is not that: the author controls it, and the polling cadence it
would describe already exists as `poll.cadenceMinutes`, which the host enforces.

## Decision

1. **The manifest declares where an extension may run.**

   ```json
   { "runtime": { "placement": ["browser", "runner"], "offline": true } }
   ```

   - `placement` lists the hosts the extension supports. The default is `["browser"]`.
   - `offline: true` asks to run in continuity shifts while the player is away.
   - `panel` and `prop-pack` kinds are browser-only. Sim rules and challenges are deterministic
     and their output is logged as commands, so placement does not affect replay.
   - The host refuses to load an extension on a host it does not list.

2. **The manifest declares limits, not cost hints.**

   ```json
   { "limits": { "fetchesPerPoll": 4, "llmCallsPerDay": { "low": 20 }, "creditsPerDay": 50 } }
   ```

   - Limits are hard caps that the host and the central spend gate enforce (ADR-0052).
   - The platform derives the cost ceiling as limits × the current price table, and measures
     actual spend per extension.
   - An extension that needs a managed resource and declares no limit gets a conservative
     default.

3. **Install is a ticket.** The host validates the manifest, derives the ceiling and raises an
   install ticket with a deterministic cost range and a note from the CFO. The default option is
   Reject. On approval the central service registers a grant with a daily cap. A new version
   that raises a limit or adds a capability needs approval again.

4. **No silent substitution of a cloud model for a local one.**
   - A tier is served by the local model in the browser.
   - On a runner, a tier is served by a cloud model only if the player's mandate for that run
     allows cloud LLM use for that extension, within its limits and budget.
   - Otherwise the call fails loudly (rule 11) and the work waits for the browser.
   - The same rule applies to staff jobs (ADR-0048).

5. **Polling has one owner at a time.** A context provider is polled by whichever executor holds
   the lease, at the declared cadence. With no executor running, facts go stale and nothing is
   charged.

Alternatives considered:

- **Self-declared `costHints`.** Rejected. Untrusted, and redundant with the enforced cadence.
- **Location in the capability name (`llm:browser-local`, `llm:cloud`).** Rejected. It doubles
  the capability set and makes an extension choose a location that is the player's decision.
- **Keep extensions browser-only.** Rejected. Context providers and publish targets are the
  extensions that matter most while the player is away.
- **Run extension code as plain Bun on a runner.** Rejected. It breaks rule 14 and browser
  parity.

## Consequences

- Positive: the player sees a derived, enforceable ceiling before installing.
- Positive: an extension behaves the same in the browser and on a runner, or does not load.
- Positive: cloud LLM use is always an explicit grant.
- Negative: this is a breaking change to the strict manifest schema and its exported JSON
  Schema; existing example manifests need the new fields or take the defaults.
- Negative: conservative defaults will make some unattended extensions do less than their
  authors expect until limits are declared.
- Negative: the install ticket and central grants depend on the spend gate (ADR-0052), which is
  not built yet. Until then extensions cannot use managed resources.
