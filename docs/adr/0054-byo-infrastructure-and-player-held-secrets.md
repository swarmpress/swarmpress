# ADR-0054 — Bring your own infrastructure, and player-held secrets

**Status:** Accepted (amends ADR-0038's "secrets never reach the browser" and CLAUDE.md rule 7)
**Date:** 2026-10-02

## Context

ADR-0038 says "Secrets never reach the browser." It was written about platform credentials:
the GitHub App key, the platform's model API key and paid third-party services. It did not
consider a player's own credentials.

ADR-0044 makes managed resources billable and promises that swarm.press will not disable local
capability to create paid features. Players should therefore be able to avoid managed costs by
bringing their own model key, their own storage and their own runner. That needs a rule for
where a player's own secret may live.

A second question sits beside it. If a published site earns real money, the CFO could report a
real profit and loss. That must not turn swarm.press into a payments intermediary.

## Decision

1. **Rule 7 is reworded.** The browser never holds platform credentials. A player may hold their
   own provider credentials on their own device.

2. **Browser-only use.**
   - The player's key is stored on the device, wrapped by a non-extractable WebCrypto key.
   - It never enters the sim, the command log, sync, the extension sandbox or central logs.
   - Calls go from the browser straight to the provider.
   - The platform cannot meter or limit this spend. Budgets shown for it are advisory.
   - A company that uses only the player's machine and keys stays in the own-machine league
     (ADR-0055); the server cannot observe such a key, and it is consistent with the principle.

3. **Unattended use.**
   - **Self-hosted runner first.** The player runs the `swarmpress` runner on their own machine
     or CI, with their key in their own environment. swarm.press holds nothing.
   - **Managed runner:** managed models only at first. Central custody of a player's model key
     is deferred.
   - **Publish-target credentials** stay in the central credential proxy (ADR-0043). It needs an
     envelope-encrypted store with rotation and an audit log. Later custody of other player keys
     would reuse it.

4. **Storage.** A player's own bucket is supported as the `external` storage class (ADR-0050): a
   public base URL verified by hash at merge. No bucket credentials are held.

5. **Presigned upload URLs are capabilities, not secrets.** They are scoped to one object and
   expire within minutes, so issuing one to the browser does not break rule 7.

6. **Real profit and loss has a hard boundary.**
   - Allowed: manual entry or CSV import of the player's own affiliate and sponsorship figures,
     labelled self-reported, kept in the browser store, with no effect on score or in-game cash.
   - Allowed with care: read-only connectors, run as local extensions with the player's own key.
   - Never: swarm.press receiving, holding, routing, splitting or paying out third-party revenue,
     or netting revenue against the balance.
   - Revenue and platform costs may be in different currencies. Deterministic code shows them
     separately or converts them; the CFO model never converts (ADR-0052).

Alternatives considered:

- **Central custody of player model keys from the start.** Deferred. It makes the central
  service a high-value target before it has a key store.
- **Forbid player keys in the browser.** Rejected. It would force players onto managed models
  and contradict ADR-0044.
- **Payouts or revenue sharing through swarm.press.** Rejected. It is a different regulatory
  position and unrelated to the product.

## Consequences

- Positive: a player can run the whole product, including continuity, without paying
  swarm.press.
- Positive: the managed service is a convenience, not a lock-in.
- Negative: spend on a player's own key is invisible to the platform, so hard limits cannot be
  enforced for it.
- Negative: a key in the browser is exposed to a compromised page. Wrapping it with a
  non-extractable key protects it at rest, not against script running in the origin.
- Negative: a lost device or cleared storage loses the key; the player re-enters it.
- Negative: the credential proxy's key store becomes security-critical infrastructure.
- Not verified: whether each provider's API permits direct browser calls with a player's key.
