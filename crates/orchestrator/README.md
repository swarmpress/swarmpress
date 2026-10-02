# orchestrator

Runs the sim's job requests for the MVP article loop (`docs/mvp.md`): standup → draft PR →
review → revision → publish (merge) → `DeployLanded`. The sim owns every transition
(ADR-0011); this crate runs exactly the job it is given and returns typed `Outcome`s.

It has no tokio, database or HTTP dependency and builds for `wasm32-unknown-unknown`, so it runs
in the browser (ADR-0038):

```sh
cargo build -p orchestrator --target wasm32-unknown-unknown
cargo nextest run -p orchestrator
```

| Piece | Implementations |
|---|---|
| `Store` (briefs, artifacts, transcripts, plan posts; JSON in/out) | `MemStore`; the browser's `CompanyStore` (Turso wasm / sqlite-wasm) through `crates/orchestrator-wasm`; later SQLite (server) |
| `Gateway` (`open_draft`, `merge`) | `FakeGateway`; `GithubGateway` over `github::ContentRepo` (native only); the browser's central gateway client through `crates/orchestrator-wasm` |
| `agents::Llm` | `FakeLlm` in tests; local models in the browser; Claude for Agency jobs |

Async traits are `Send` natively and `?Send` on wasm32 (`agents::MaybeSendSync`).

Plan thread for one article: `minutes, artifact, handoff, review, artifact, handoff, review,
artifact, status`. See `tests/loop.rs`.
