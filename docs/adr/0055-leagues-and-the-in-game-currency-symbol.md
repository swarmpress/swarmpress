# ADR-0055 — Leagues and the in-game currency symbol

**Status:** Accepted (amends ADR-0021, ADR-0033)
**Date:** 2026-10-02

## Context

Two owner decisions follow from real money entering the product.

**Paid progress.** ADR-0033 says: "Credits buy capability and content, never score." Continuity
(ADR-0048) lets a company do real work while the player is away, on a managed runner paid from
the balance or on a self-hosted one. More published quality pages raise real audience and the
audited score (ADR-0021). Continuity therefore buys progress, and the sentence in ADR-0033 no
longer holds as written.

**The € symbol.** In-game cash is integer cents shown as € in the Finance panel
(`crates/sim-core/src/economy.rs`, `apps/game/src/ui/components/Finance.tsx`). Real money is
euros too (ADR-0051). Showing both in € is the confusion ADR-0033 was written to prevent, and
the CFO's numbers validator forbids currency conversion.

## Decision

1. **Separate leagues.** The leaderboard has two leagues:
   - **Own machine:** the company was only ever executed by the player's browser and never
     spent on managed resources.
   - **Open:** any continuity, managed or self-hosted, or any managed spend.
2. **League membership is decided from facts the server holds**, never from a client claim:
   - the executor kind recorded on sealed log segments (ADR-0045): any segment sealed by a
     `cloud` or `self` executor moves the company to Open;
   - managed spend in the ledger (ADR-0052): any settled spend on a billed resource moves the
     company to Open.

   The move is one-way for the season in which it happens.
3. **A player's own key in their own browser counts as own machine.** A player may use their own
   provider API key in their browser (ADR-0054). swarm.press cannot detect this: the calls never
   touch the platform. It is consistent with the principle (the player's machine, the player's
   account), and the Own machine league accepts it. The league name means "no swarm.press
   continuity and no managed spend", not "local models only". The UI says so.
4. **ADR-0033's sentence is reworded.** "Credits never buy in-game cash, reputation or score
   directly. They buy capacity, and companies that use it compete in the Open league."
   Money still never converts to score, cash or reputation by any direct path.
5. **Replay-verified challenges (ADR-0043) remain pay-free.** A challenge score comes from a
   command log replayed by the runner, so spending cannot raise it.
6. **In-game cash gets its own symbol.** € is reserved for real money. The symbol is **not
   chosen yet**; the default proposal is "§". Choosing it is an open item for the owner.
   - It is a display change. `Company.cash` stays integer cents in the sim; no sim state or hash
     changes.
   - It touches `apps/game/src/ui/format.ts`, `crates/agents/prompts/cfo.md` and the game-design
     docs.
7. **Two Finance tabs.**
   - **Company (game):** in-game cash, runway, burn, project budgets, the CFO's finance report.
     As today, in the new symbol.
   - **Real money:** reads the wallet live from the central service and shows credits with the
     euro value beside them, spend by category and department, and pending approvals.
8. **The CFO never sees both currencies in one job input.**
   - `finance-report` stays game-only.
   - `infra-spend-report` carries real figures only (ADR-0052).
   - The unit-tagged validator (ADR-0052) rejects a currency symbol on a number that came from
     the other unit.

Alternatives considered:
- **Accept paid progress on one board.** Rejected by the owner: the top of the board would
  favour spenders.
- **Cap the counted new quality pages per window.** Not chosen. It limits honest high-output
  companies too, and still mixes the two groups. It can be added inside the Open league later.
- **A "local models only" league.** Rejected: it cannot be enforced, because a player's own key
  in the browser is invisible to the platform.
- **Keep € for the game and show real money as credits only.** Rejected by the owner: the wallet
  and checkout need euros anyway, and two € amounts would still meet on one screen.
- **Keep both in € and separate them by labels.** Rejected: one misread label is a real-money
  mistake.

## Consequences

- Positive: paying for continuity is honest and visible, and it does not distort the league for
  players who run only their own machine.
- Positive: league membership rests on server-held facts, so it cannot be claimed falsely.
- Positive: € on screen always means real money.
- Positive: the CFO's two reports cannot mix units.
- Negative: two boards split the audience, and the Own machine league still includes players
  with strong hardware or their own API key.
- Negative: a single managed job moves a company to Open for the season. The UI must warn before
  the first spend.
- Negative: self-hosted continuity is detected only through the executor kind the runner
  declares with its token. A player who modifies the runner to claim `browser` is cheating in
  the same class as a modified client (ADR-0038).
- Negative: renaming the currency symbol touches prompts, UI and docs, and existing screenshots
  and visual baselines that show €.
- Negative: ADR-0021 and `docs/game-design/leaderboard.md` are stale until the leagues are
  written into them.
- Open: the symbol itself. "§" is the default until the owner decides.
- Not built: leagues, the Real money tab, the symbol change and the validator's unit tags.
