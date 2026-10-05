# Model qualification: Ternary Bonsai 2 (in-browser WebGPU) on Apple M3 Max, 128 GB: system stability

> **Date:** 2026-10-05 · **Verdict:** NO-GO (system stability)
> **Written by hand.** A run that takes the machine down writes no raw results, so the generated
> report of the same day ([`2026-10-05-bonsai-apple-m3-max-128gb.md`](2026-10-05-bonsai-apple-m3-max-128gb.md))
> cannot show this. Its load rows (warm start p50 11.5 s, GPU peak 10.75 GB) stay valid.
> Thresholds: [`docs/design/mvp-runtime.md`](../design/mvp-runtime.md) section 7 (ADR-0057).

## What happened

Every attempt at the generating part of the suite made the owner's machine unusable within a few
minutes:

1. The model loaded normally (the profile on the internal SSD, as the runbook asks).
2. Once the fixtures started generating, the whole machine stopped responding, and the fans ran
   at full speed.
3. WindowServer restarted, which ends the macOS login session. The run, the terminal and every
   open app were lost.

It happened on the first attempt (2026-10-05, the model ready at about 11:08, the session lost at
about 11:11) and again on every later attempt the same day. The two load-only runs (cold on
2026-10-04, warm with five loads on 2026-10-05) finished normally: loading the 27B model is not
the trigger, generating with it is.

| | |
|---|---|
| Machine | Apple M3 Max, 128 GB, macOS 26.4 (the target machine of the runbook) |
| Browser | Chrome 154.0.8037.95, headed, persistent profile on the internal SSD |
| Model | prism-ml/Ternary-Bonsai-2-27B-gguf `Ternary-Bonsai-2-27B-PTQ1_0.gguf` at b072e1d3b35a |
| Engine | sha256 d94c1729d7a7…, decode pipeline depth 4 (calibrated by the engine), 16K context |
| Commit | 9966560 on main |
| Runs | the suite run of the runbook with the office scene at medium (its default) |

## Why this is a no-go

- The thresholds table has no row for it, because it is worse than every row there. A lost GPU
  device is recoverable in the game ("Reload the model"); a restarted WindowServer logs the player
  out and loses their unsaved work in every app.
- The M3 Max with 128 GB is the strongest machine the MVP's audience can have. A backend that
  cannot run here cannot run on any player's machine.
- A no-go row decides on its own (`docs/runbooks/model-qualification.md`, "Reading the report").

## What is not established

- **The mechanism.** There is no crash report for 2026-10-05 in Console (no
  `WindowServer….ips`), which argues against an ordinary WindowServer crash. Two causes would
  leave none: a GPU restart by the kernel, or watchdogd killing a WindowServer that could not get
  GPU time. Both point at the engine's GPU submissions keeping the GPU busy too long for the
  compositor. The kernel log was not read (the agent's terminal has no Full Disk Access).
- **Whether a lighter setting survives.** The attempts ran with the scene at medium and the
  engine's own pipeline depth. Whether generation alone (`BENCH_QUALITY=off`) with
  `BENCH_DEPTH=1` also takes the machine down was not tested. That is step 1 of the fallback
  ladder, and the only one that keeps this model and engine; the engine is vendored unmodified
  (ADR-0057, decision 3), so how it splits its GPU work cannot be changed here.

## Next

The next candidate is Chrome's built-in AI (`BENCH_LLM=chrome`, step 6 of the fallback ladder),
qualified with the same harness and its own report. Every candidate starts with a short smoke run
(one fixture, a tenth of its prompts, scene off) before any long run, so that a machine-stopping
backend costs minutes and not a session.
