# ADR-0047 — Player-owned repositories

**Status:** Accepted (amends ADR-0009)
**Date:** 2026-10-02

## Context

ADR-0009 put one site repository per company in a platform organisation, with the GitHub App
installed on that organisation. The server defaults `companies.site_repo` to
`{GITHUB_SITES_ORG}/{login}-site`.

That choice has costs that grow with the number of players:

- **One installation for everyone.** All companies share one installation's API rate limit
  (ADR-0009 already lists 5,000 requests per hour as a negative).
- **Shared build minutes.** For private repositories the organisation's GitHub Actions minutes
  are shared by every site.
- **Shared fate.** A content farm that abuses the free tier publishes under the platform's
  organisation. A suspension of that organisation takes every site down.
- **The player does not own their work.** swarm.press says the company produces a real website
  that belongs to the player. A repository in someone else's organisation is not that.

ADR-0046 adds a second repository per company, a private one that mirrors company state. It
holds staff transcripts and should not sit in an organisation the platform controls.

## Decision

1. **Repositories belong to the player.** A company's site repository, and its private state
   repository, live on the player's own GitHub account or organisation.

2. **The swarm.press GitHub App is installed by the player** on their account, with access to
   the selected repositories only. The platform organisation is no longer the home of player
   repositories.

3. **Unchanged from ADR-0009 and ADR-0019:**
   - the site repository is the canonical store for pages, collections, site config and theme;
   - sign-in uses the App's OAuth flow with identity scope only;
   - repository writes use short-lived installation tokens minted by the server, never the
     user's token, and never a credential held in the browser;
   - all writes go through the gateway and `PathPolicy`.

4. **Installation tokens are narrowed per use.** A token minted for a company is restricted to
   that company's repositories and to the permissions the operation needs.

5. **Onboarding** gains an install step: sign in, install the App on the account, pick or
   create the site repository from the starter template, and let the server create the private
   state repository. The server stores the installation id and repository ids per company (the
   installations table that ADR-0039 lists and that does not exist yet).

6. **Leaving costs nothing.** A player who uninstalls the App keeps both repositories, their
   history and their deployed site. Reinstalling restores service.

7. **The platform organisation** is kept only for platform-owned repositories (the starter
   template, examples), and for the existing cinqueterre.travel repository until its cutover.

Not built: there is no installations table, `create_repo_from_template` has no caller in the
server, and onboarding (FEAT-048) and the App client (FEAT-046) are planned.

## Consequences

- Rate limits, Actions minutes and Pages limits are per player. One player's use cannot starve
  another's.
- Abuse is attributed to the abuser's account, not to the platform's organisation.
- The player truly owns the site and the company backup, which is what the product promises.
- **Negative:**
  - Onboarding has one more step, and it leaves the game for GitHub's install screen.
  - The player can break things the platform used to control: delete the repository, change
    branch protection, edit `.github/workflows/`, uninstall the App. The gateway has to detect
    these and raise a ticket instead of failing silently.
  - `PathPolicy` restricts what agents write. It cannot restrict what the owner writes by hand.
    Site CI and the merge check remain the guard.
  - Private repositories on a free personal account have limited Actions minutes and no Pages.
    A public site repository avoids both; the state repository does not build anything.
  - Webhooks arrive per installation. Mapping a repository to a company now goes through the
    installations table.
  - Existing companies under the platform organisation need a transfer path.
- **Unverified:** GitHub's rate limits per installation, the Actions minute allowances and the
  Pages rules for private repositories are from memory and must be checked before onboarding
  copy is written.
- **Alternatives rejected:**
  - *Keep the platform organisation.* The costs in the Context section.
  - *Platform organisation as the default with a transfer later.* Two code paths, and most
    players would stay on the shared installation; the scaling and shared-fate problems remain.
  - *User OAuth tokens with `repo` scope.* Already rejected in ADR-0009 and ADR-0019; the
    browser would hold a credential that can write anywhere the user can.
