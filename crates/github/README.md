# github

The only thing in swarm.press that talks to GitHub (FEAT-046, ADR-0009, ADR-0047): the
`RepoApi` trait with a real REST client (`HttpGitHub`, raw reqwest) and an in-memory fake
(`FakeGitHub`), the path guard (`GuardedRepo` + `PathPolicy`), the idempotent content flows
(`ContentRepo`: draft branch, page commit, pull request, squash merge), provenance (the staff
persona as git author, the squash commit's trailers), the knowledge-pack snapshot, webhooks and
the rate governor. The module list is in `src/lib.rs`.

## Tests

```bash
cargo nextest run -p github
```

| Suite | Covers |
|---|---|
| unit (`src/**`) | auth, policy, provenance, rate limits, snapshot reader, the fake's git model |
| `tests/http_contract.rs` | `HttpGitHub` against wiremock: every request, header and status mapping |
| `tests/fake_github.rs`, `tests/content_repo.rs`, `tests/policy.rs`, `tests/snapshot.rs`, `tests/webhooks.rs` | the fake, `ContentRepo` idempotency, `PathPolicy`, snapshots, webhook parsing |
| `tests/live_repo.rs` | the gateway's content path as one scenario: against the fake on every run, against a real sandbox repository only when asked for (below) |

## The live test (increment G2)

`tests/live_repo.rs` runs the calls the server's gateway makes, in its order, against a
repository on github.com: a scratch base branch; a draft as a content agent with the persona
as git author and job trailers; the Merges API (201, then 204, and 409 for a real conflict);
the squash merge at the exact head with `Reviewed-by`, `Approved-by` and `Co-authored-by`,
read back from the commit; the draft branch deleted; a second pull request opened and closed.
It then deletes every branch it created and checks that the default branch did not move.
Merged and closed pull requests stay in the repository's list (GitHub cannot delete them).

The same scenario runs against `FakeGitHub` in every test run
(`the_live_scenario_against_the_fake`), so it cannot rot unnoticed. The live variant is
`#[ignore]`d, needs both settings below, and refuses `swarmpress/cinqueterre.travel` whatever
the environment says. It never runs in CI.

What the owner creates first:

1. A **sandbox repository** under their own account, e.g. `<you>/swarmpress-sandbox`: public or
   private, initialised with a README so it has a default branch. No Pages, no workflows
   needed. Nothing on its default branch changes.
2. A **fine-grained personal access token** limited to that one repository, with
   Contents: read and write, Pull requests: read and write, Metadata: read (always included).
   Actions: read is not needed for this test (the server's deploy poller needs it).

These permissions are taken from GitHub's documentation and have not been verified against the
real API by this project yet; a 403 from the test names the call that needed more.

Run it (it is the only command here that contacts GitHub):

```bash
SWARMPRESS_LIVE_REPO=<you>/swarmpress-sandbox GITHUB_TOKEN=<token> \
  cargo nextest run -p github --run-ignored only -E 'test(live_content_path)' --no-capture
```

`GITHUB_API_URL` points it at another API base (GitHub Enterprise). If the test is interrupted
(Ctrl-C), branches named `live-test/*-<run>` and `drafts/content-live1-<run>`,
`drafts/content-live2-<run>` may remain; delete them by hand. A panic inside the scenario
still runs the clean-up.

What a green run settles, from the server README's list of unverified GitHub behaviour:

- the Contents API's `author` with the committer left out: the persona is the author, the
  token's user the committer;
- the Merges API answering 201 with the merge commit, 204 when there is nothing to merge, 409
  on a conflict;
- the squash merge's `commit_title` and `commit_message` landing as the commit message.

Still unverified after it: the check runs a superseded or cancelled deploy run leaves on its
commit (the deploy poller's input); the fork rehearsal (`docs/runbooks/fork-rehearsal.md`)
observes those on a real Pages deploy.
