/**
 * The temperamental coffee machine (a sim rule).
 *
 * Runs in deterministic mode: `Math.random` is seeded per call by the host and
 * `Date` is pinned to the sim clock, so the same seed always proposes the same
 * commands. The host validates them and appends them to the command log;
 * replay re-applies the log and never re-runs this code.
 */
import { defineRule, type ProposedCommand, type WorldView } from "@swarm-press/sdk/runtime";

/** Chance per morning, in permille (integers only in sim commands). */
const BREAK_PERMILLE = 300;
const REPAIR_MINUTE = 10 * 60;

let brokenOnDay = -1;

export default defineRule({
  onDayStart(view: WorldView): ProposedCommand[] {
    const roll = Math.floor(Math.random() * 1000);
    if (roll >= BREAK_PERMILLE) return [];
    brokenOnDay = view.day;
    return [
      { type: "DeviceFault", device_kind: "coffee-machine", day: view.day },
      { type: "MoodBeat", people: "all", delta_permille: -20, reason: "coffee-machine-broke" },
    ];
  },
  onStep(view: WorldView): ProposedCommand[] {
    if (brokenOnDay !== view.day || view.minute !== REPAIR_MINUTE) return [];
    brokenOnDay = -1;
    return [{ type: "DeviceRepaired", device_kind: "coffee-machine", day: view.day }];
  },
});
