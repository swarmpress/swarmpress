# Runbook: the fork rehearsal

The MVP loop against a fork of the live site, with real pull requests, real merges and real
GitHub Pages deploys, before anything touches `swarmpress/cinqueterre.travel`
([docs/mvp.md](../mvp.md), milestone B; increment G2). Features: FEAT-046, FEAT-048. Decisions:
[ADR-0047](../adr/0047-player-owned-repositories.md) (the repository belongs to the player),
[ADR-0061](../adr/0061-knowledge-pack-and-gateway-read-finalise-close.md) (finalise on merge,
deploy polling). The live site's own migration is [the cutover runbook](cinqueterre-cutover.md).

Nothing here writes to `swarmpress/cinqueterre.travel`: GitHub reads it once to make the fork,
and every write goes to the fork. The local clone `cinqueterre.travel/` next to this repository
tracks the live repository; do not use it for the fork.

## What the owner creates and provides

| What | How |
|---|---|
| The fork | `<you>/cinqueterre.travel` under your personal account (step 1) |
| A Pages address served at the root of a host | a custom domain you control, or the fork renamed to `<you>.github.io` (step 3) |
| The gateway token | fine-grained personal access token; repository access: the fork only; Contents read/write, Pull requests read/write, Actions read/write (a Retry after a failed deploy re-runs its jobs), Metadata read (step 5) |
| A token for the fork's `MONOREPO_PAT` secret | fine-grained, repository access "Public repositories (read-only)": the deploy workflow checks out the public `swarmpress/swarmpress` with it (step 1) |
| Chrome | on the machine that runs the server |

The token permissions are taken from GitHub's documentation and have not been verified by this
project. A 403 in the server's log names the call that needs more.

## 0. Before you start

- **The scripted article must pass the article profile (increment P1).** With a real GitHub the
  server always enforces the blog-article profile (`SWARMPRESS_ARTICLE_PROFILE=off` is refused).
  Until the scripted model (`?llm=fake`, `apps/game/src/llm/mvp-script.ts`) writes the new
  article shape (hero, sections, closing note), its draft is refused with 422 at step 7 and
  nothing reaches the fork. Check: `apps/game/e2e/central-server.mjs` no longer defaults
  `SWARMPRESS_ARTICLE_PROFILE` to `off`, and the MVP e2e passes with the profile enforced.
  Steps 1 to 6 can be done before that.
- **Optional, one minute:** run the content-path live test against a throwaway sandbox
  repository (`crates/github/README.md`). A green run confirms the token and three GitHub
  behaviours the gateway relies on before the fork is involved.

## 1. Fork the site and set it up

1. On <https://github.com/swarmpress/cinqueterre.travel>: **Fork**, owner: your account, name
   `cinqueterre.travel` (or `<you>.github.io`, see step 3), "Copy the `main` branch only": on.
2. In the fork's **Settings**:
   - General → Pull Requests → **Automatically delete head branches**: on (what G1 does for the
     live repository).
   - Secrets and variables → Actions → **New repository secret** `MONOREPO_PAT`: the public
     read-only token. Secrets are not copied into a fork, and the workflow's checkout step fails
     when the secret it names is unset.
   - Pages → Build and deployment → Source: **GitHub Actions**.
3. In the fork's **Actions** tab, enable workflows (GitHub disables them on a new fork).

A public fork's Pages site is public. Pages for a private repository needs a paid plan (from
memory, unverified).

## 2. Pin the fork's deploy workflow (cutover step 0, on the fork)

The workflow builds the theme from `swarmpress/swarmpress` at its default branch, which has
changed since the last live deploy. Pin it exactly as cutover step 0 does for the live site, so
the rehearsal deploys what the live site will. Edit `.github/workflows/deploy.yml` on the fork
(GitHub's web editor, or a clone of the fork) and commit to the fork's `main`:

```diff
       - name: Checkout monorepo (for theme)
         uses: actions/checkout@v4
         with:
           repository: swarmpress/swarmpress
+          # Pinned to the last TypeScript-era commit (tag legacy-final), as cutover step 0.
+          ref: 391d5de8fe4eae3184dfd3f845f7e418239123f9
           path: swarmpress
           token: ${{ secrets.MONOREPO_PAT }}
```

In the same commit change the line `echo "cinqueterre.travel" > dist/CNAME`: write your own
domain (option A in step 3), or delete the line (options B and C). The fork must never carry the
live domain. (For a deploy from Actions GitHub documents that a `CNAME` file in the artifact is
ignored; unverified.)

## 3. A Pages address at the root of a host

The frozen theme builds absolute links and asset paths (`/en/...`, `/_astro/...`; its Astro
config has no `base`), so the fork's site must be served at the root of a host:

- **A. A custom domain** (recommended): fork Settings → Pages → Custom domain, e.g.
  `rehearsal.<your-domain>`; a DNS `CNAME` record from it to `<you>.github.io`; wait for the
  certificate, then Enforce HTTPS.
- **B. The fork named `<you>.github.io`** (only if you have no user site yet): Pages serves it at
  `https://<you>.github.io/`. Use that repository name everywhere below.
- **C. The project address** `https://<you>.github.io/cinqueterre.travel/` (degraded): the
  pages build and deploy and the gateway's path is fully exercised, but in a browser the styles
  and internal links point at the host's root and 404. The checks in step 8 still work with
  `SITE` set to the address including `/cinqueterre.travel`.

Below, `SITE` is that address without a trailing slash and `FORK` is `<you>/cinqueterre.travel`.

## 4. The pinned workflow is green before any agent pull request

Fork → Actions → "Deploy to GitHub Pages" → **Run workflow** on `main`.

Gate:
- the `build` and `deploy` jobs are green;
- `curl -s -o /dev/null -w '%{http_code}\n' "$SITE/en/"` prints 200, and so does
  `"$SITE/en/blog/last-light-on-sentiero-azzurro/"`.

Note the fork's `main` head: it is the rollback point.

```sh
git ls-remote "https://github.com/$FORK" refs/heads/main
```

A failure here is how the live site would fail on its next deploy (the finding behind G1): stop
and fix that first.

## 5. The token and the local configuration

1. Create the gateway token: GitHub → Settings → Developer settings → Fine-grained tokens →
   Generate. Resource owner: you. Repository access: **Only select repositories** → the fork.
   Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**,
   **Actions: Read and write** (a Retry after a failed deploy re-runs its jobs; Metadata: Read-only is added by itself). An expiry of a month.
2. Configure the server:

   ```sh
   cp .env.rehearsal.example .env.rehearsal.local   # git-ignored; never commit it
   # replace YOUR_GITHUB_LOGIN (twice), paste the token into GITHUB_TOKEN
   ```

   It has its own database (`data/rehearsal/`), so the rehearsal company never mixes with the
   fake-GitHub company of `.env`.
3. Start it:

   ```sh
   scripts/run-local.sh --env .env.rehearsal.local --build
   ```

   Read what it prints before you answer `y`:

   ```text
     GitHub      REAL, token mode
     new company writes to   <you>/cinqueterre.travel (base main)
     allowed     <you>/cinqueterre.travel
   ```

   An "existing companies" line naming any other repository means the wrong database.

## 6. Bind a company to the fork

Open <http://localhost:8080/?central=1&llm=fake&ff=09:00&login=rehearsal> in Chrome. The
rehearsal database is new, so the company "rehearsal Dispatch" is founded with the server's
binding. The boot screen says **Writes to `<you>/cinqueterre.travel` · base `main`**, and the
HUD keeps saying it. If it names anything else, close the tab and stop the server (Ctrl-C).

A company that already exists keeps its binding. To move one to the fork, close its tab (or pass
`--force`, which leaves an open tab read-only) and run:

```sh
scripts/rebind-company.sh --env .env.rehearsal.local --login rehearsal "$FORK"
```

The server refuses while the company has open pull requests or a deploy pending, and records a
`SiteRebound` event.

## 7. The MVP loop with the scripted model

The tab runs the loop of "One article, from standup to published" in
[getting-started](../guides/getting-started.md), on the real fork:

| Step | In the game | On the fork | Server log |
|---|---|---|---|
| Standup (09:00) | Giulia pitches; a work item appears | | |
| Draft | Plan thread: artifact, handoff | pull request "Draft: …" from `drafts/content-content-…` into `main`; the committer is you, the author the persona (`Giulia Rossi <staff-1+<company>@staff.swarm.press>`) when the game sends the job's attribution (G6), else you | `gateway draft` |
| Review 6, revision, review 8 | the review posts | a second commit on the same pull request | `gateway draft` |
| Approval | Inbox: the PublishApproval ticket with the measured checks and the pull-request link; answer **Publish** | | |
| Merge | the item waits for its deploy | on the branch: "Merge main into …", "Publish: …", "List: …" (the blog index entry); then the squash commit on `main`, with the `Job`, `Reviewed-by`, `Approved-by` and `Co-authored-by` trailers when the attribution was sent; the branch is deleted | `gateway merge` |
| Deploy | | Actions: a run on the squash commit, `build` then `deploy` | the poller: `DeployLanded` with `source: "poll"` within one poll (`SWARMPRESS_DEPLOY_POLL_SECS`, 30 s) of the `deploy` job finishing |
| Published | the item is Published; a status post in the Plan | | |

In the browser console, `__swarmpress.session.events()` lists the `DeployLanded` event and
`__swarmpress.session.items()` the item's status. The poller waits for the check run named
`deploy` (`SWARMPRESS_DEPLOY_CHECK`), the workflow's second job; that a job without a `name:`
reports a check run named by its id is from GitHub's documentation, unverified. A failed deploy
emits `DeployFailed`; the fork's previous Pages deployment stays live.

## 8. Check the deployed fork

```sh
SLUG=harvest-week-in-manarola        # the scripted article; the PR's page path names it
curl -fsS "$SITE/en/blog/$SLUG/" -o /tmp/article.html && echo "article 200"
grep -o '<h1' /tmp/article.html | wc -l                       # exactly 1
curl -fsS "$SITE/en/blog/" | grep -c "/blog/$SLUG"            # listed on the blog index: 1 or more
for lang in de fr it; do curl -s -o /dev/null -w "$lang %{http_code}\n" "$SITE/$lang/blog/$SLUG/"; done
grep -o 'href="/[^"#?]*' /tmp/article.html | sed 's/^href="//' | sort -u | while read -r p; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$SITE$p")" "$p"
done | grep -v '^200 ' || echo "every internal link answers 200"
```

Also look, once, in the browser: the title and the hero image are visible; nothing shows literal
`**markdown**`. On GitHub: the article on the fork's `main` has `"status": "published"`; the
squash commit's author is you (the merge API has no author field) and, once the game sends the
attribution (G6), its message carries the trailers. Milestone C needs the trailers; the
rehearsal is where their absence shows.

## 9. Clean up

- Stop the server (Ctrl-C in its terminal).
- To run the loop again: the article's path is create-only, so it has to go. Revert its squash
  commit on the fork's `main` (the "Revert" button on the merged pull request, then merge that),
  or reset the fork's `main` to the step-4 head (a force-push to your own fork; never on the live
  repository), or delete the fork (Settings → Danger zone) and start again at step 1.
- Branches left by a run that stopped half-way: `drafts/content-*` on the fork; close their pull
  requests and delete them.
- Local state: `rm -rf data/rehearsal`, and clear the site data of `localhost:8080` in Chrome
  (the company's browser store), or use another `login=`.
- When the rehearsal is over, revoke both tokens (Developer settings → Fine-grained tokens).

## 10. Record the run

The date and this repository's commit, the pull request number, the squash commit, the deploy
run, how long the poller took to report it, and the output of step 8. Milestone B's seven-day
rehearsal (docs/mvp.md, track E) repeats steps 7 and 8 for each article on the real model; this
runbook is its setup.

## Later: the first live article (milestone C)

Not before all of these hold, in this order:

1. **Cutover step 0 on the live repository** ([cutover runbook](cinqueterre-cutover.md), G1, the
   owner's go): the `legacy-final` tag, the monorepo checkout in the live `deploy.yml` pinned to
   `391d5de8fe4eae3184dfd3f845f7e418239123f9`, one `workflow_dispatch` deploy green, the baseline
   crawl taken, delete-branch-on-merge on. It is the only change to the live repository before
   milestone C.
2. The fork rehearsal passed (milestone B: seven game days, every merged article builds with one
   `<h1>`, appears in the index, its links answer 200, no item stuck, the replay reproduces the
   hash), its commits carry the persona and the trailers (G6), and the eval thresholds of track
   E are met with the owner's reading of the articles.
3. `SWARMPRESS_STAFF_EMAIL_DOMAIN` is chosen: the live site's history keeps it.
4. A gateway token for `swarmpress/cinqueterre.travel` with the same permissions and repository
   access to that repository only (an organisation may have to approve a fine-grained token;
   unverified).
5. `.env.live.local` from `.env.rehearsal.local` with `SWARMPRESS_DEFAULT_SITE_REPO` and
   `SWARMPRESS_ALLOWED_SITE_REPOS` set to `swarmpress/cinqueterre.travel` only, then
   `scripts/run-local.sh --env .env.live.local --live-site` (the script refuses the live
   repository without that flag). Bind the company with `scripts/rebind-company.sh` or found a
   new one, and check the boot screen names the live repository.
6. One article a day; the CEO approves each one in the Inbox (the default `ApproveAll`).
7. After the merge, by hand: the live page, its index card, its commit trailers (docs/mvp.md,
   "Verification").
8. Rollback ready: revert the squash commit on `main` (the merged pull request's "Revert"
   button). A failed build leaves the previous Pages deployment live.
