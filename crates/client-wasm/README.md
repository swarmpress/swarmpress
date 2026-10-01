# client-wasm

wasm-bindgen facade over `sim-core` and `protocol` for the browser client
(`apps/game`). Build it into `crates/client-wasm/pkg` with:

```sh
cargo xtask wasm            # debug
cargo xtask wasm --release  # wasm-release profile (opt-level z, ~0.5 MB)
```

The build needs `wasm-bindgen-cli` **0.2.100** (it must match the
`wasm-bindgen = "=0.2.100"` pin):
`cargo install wasm-bindgen-cli --version 0.2.100`.

## API (TypeScript view)

```ts
export function version(): string
export class Sim {
  constructor(seed: bigint)              // empty company on the default lot
  static demo(seed: bigint): Sim         // the demo office (5 staff)
  tick(): void                           // one 100 ms step
  advance(steps: number): void
  step(): bigint
  hash(): bigint                         // lockstep desync check
  day(): number
  minute_of_day(): number
  steps_per_day(): bigint
  cash_cents(): bigint
  apply_command(bytes: Uint8Array): void            // postcard Command; throws the reason
  apply_server_command(bytes: Uint8Array): void     // postcard ServerCommand (offline sandbox)
  validate_command(bytes: Uint8Array): string | undefined  // undefined = would apply
  render_state(): Uint8Array             // postcard sim_core::RenderState (mm)
  render_state_json(): string            // JSON, metres, TS RenderState shape
  layout_json(): string                  // JSON, metres, TS BuildingLayout shape
}
```

`render_state_json()` carries the M0 contract fields (`minute`, `day`,
`roomLights`, `monitors`, `deskLamps` keyed by desk id, `staff[]` with
`id/name/color/x/z/seatedAt`) plus `phase`, `daylight`, `rooms[]` (light
`off|dim|on`, occupancy), `devices[]` and per-person `pose`, `activity`,
`path {waypoints, startStep, speed}` (metres per step) for interpolation.

`layout_json()` gives `width`, `depth`, `originX`, `originZ`, `wallHeight`,
`entrance` and `rooms[]` with `windows`, `doors`, `desks` (with `rot` in
radians and `seat`), `ceilingLights` and other `props`. Room `kind` values are
the sim's kebab-case kinds (`newsroom`, `editor-office`, `meeting-room`,
`photo-studio`, `seo-lab`, …); ids are strings like `room-1`, `equip-7`,
`staff-3`.

## Tests

Natively (unit tests + the golden test as a plain `#[test]`):

```sh
cargo test -p client-wasm
```

Under wasm32 in Node, with the test runner from `wasm-bindgen-cli` 0.2.100
(paired with the `wasm-bindgen-test = "=0.3.50"` dev-dependency):

```sh
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=wasm-bindgen-test-runner \
  cargo test -p client-wasm --target wasm32-unknown-unknown
```

`tests/golden_wasm.rs` runs the scripted 50,000-step demo office and asserts
the same `GOLDEN_HASH` as `crates/sim-core/tests/golden.rs`, proving the wasm
replica and a native server stay in lockstep. Only `client-wasm` can be tested
on wasm32: `sim-core`'s dev-dependencies (proptest, criterion) do not build
there.
