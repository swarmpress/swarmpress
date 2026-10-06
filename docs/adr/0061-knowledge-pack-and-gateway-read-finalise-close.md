# ADR-0061 — Knowledge pack; gateway read, finalise and close; create-only article paths

**Status:** Accepted (amends ADR-0013 and ADR-0009); decision 5 amended by ADR-0070 (explicit article updates)
**Date:** 2026-10-02

## Context

The closed world of ADR-0013 is enforced nowhere in the running path. `crates/knowledge` builds
the entity, media and page indexes but no crate depends on it, the browser receives only a
trimmed fixture style guide, and the gateway has no read endpoint. Writers are told that links
and media must come from indexes they are never given.

The gateway accepts any JSON object under `content/**`. A draft whose slug matches an existing
article overwrites it. A merged page keeps `status: "draft"`, has no visible title on the live
theme, and is not listed on the blog index. A cancelled item leaves its pull request and branch
open. The server learns of a deploy only through a webhook, which a server on localhost cannot
receive, and maps it by exact sha, so a burst of merges strands the earlier item.

Detail: [`docs/design/mvp-pipeline.md`](../design/mvp-pipeline.md) sections 3, 4, 5 and 7.

## Decision

1. **One knowledge pack per site commit.** `GET /api/gateway/knowledge` (lease required, ETag =
   base head) returns the site's config files verbatim (entity, media and sitemap indexes, style
   guide, writer prompt, content calendar, linking policy, media guidelines), the page list and
   the blog index. The browser caches it by commit and refetches before each standup and after
   each merge.
2. **`knowledge` is compiled into the orchestrator.** Closed-world checks run inside the repair
   loop, so an unknown link or media id is a validation error returned to the model (rule 5).
   Model-facing ids are shortlist aliases; the orchestrator resolves them.
3. **Article shape for the frozen theme.** The orchestrator assembles a hero block (the only
   `<h1>`), intro, sections and a closing note; text is plain; `seo` uses localized objects; the
   slug carries the four language keys with English text.
4. **Server-side validation.** The gateway validates the page schema and the article profile,
   checks links and media against the same indexes, and refuses raw HTML in the two fields the
   theme prints unescaped.
5. **Article paths are create-only.** A draft is refused if the path exists on the base branch
   or another open pull request of the company targets it.
6. **Finalise on merge, in the same pull request:** verify the reviewed head, merge base into
   the branch, set `status: published`, append the blog-index entry, squash-merge. The index is
   never touched before finalise, so open pull requests cannot conflict on it.
7. **Deploy observation by polling.** A background task in the server watches merged, unlanded
   pull requests through the checks or deployments API. A successful deployment lands every
   merge at or before that commit; a failure emits `DeployFailed`. The webhook stays as a second
   source.
8. **`POST /api/gateway/close`** closes a pull request this company opened and deletes its
   branch; a day-start sweeper uses it for cancelled items.

Nothing here is built. Increments K1, K2, P1, G3, G4, G5 and G7 of `docs/mvp.md` implement it.

## Consequences

- Writers and the editor work from the site's real voice and facts, and cannot invent links or
  images.
- A compromised or buggy browser cannot overwrite an existing article or write an invalid page.
- An article is live, titled, illustrated and listed when its pull request merges.
- **Negative:**
  - The server gains `knowledge` and `content-model` as dependencies, and the orchestrator wasm
    grows (estimated 40 to 80 kB gzip; the CI size budget may need raising deliberately).
  - English text is served under `/de`, `/fr` and `/it` with a mislabelled language, as most
    existing articles already are. Translation is not possible on the frozen theme.
  - Finalise adds two commits to the branch before the squash.
  - Polling costs a few API calls per merged pull request until it lands.
- **Unverified:** the GitHub Merges API behaviour for bringing base into a branch; the tarball
  snapshot route; that the deploy builds blog pages through the catch-all route.
- **Alternatives rejected:**
  - *A server endpoint that checks each draft.* A network round trip inside every repair turn,
    and it would not work with the fake gateway in native tests.
  - *Shipping every page and collection to the browser.* About 10 MB; the page list is enough.
  - *An English-only slug.* Three blog index pages would link to a 404.
  - *A tunnel for the deploy webhook.* Events are lost while it is down, and it needs a public
    endpoint.
