/**
 * The one interpreter bundle the game runs every tool with (FEAT-091, T-1).
 *
 * Unlike a tool's own skill (`compile.ts`, the graph embedded), this skill
 * takes the graph and its types as the call's data: the browser loads it once
 * into a sandbox whose capabilities and origins are the tool's derived
 * manifest (`blueprint::tools::manifest`), and calls `run`. The sandbox, not
 * the graph, decides what can be reached. Graphs are parsed (defaults filled)
 * by the host before the call. Sandbox-safe: no Zod.
 */
import { defineSkill, type HostContext } from "@swarm-press/sdk/runtime";
import type { ToolGraph } from "./graph.ts";
import { runGraph, type Recorded, type RunResult } from "./interpret.ts";
import { contextHost } from "./skill.ts";
import { TypeRegistry } from "./types.ts";

export interface RunArg {
  graph: ToolGraph;
  types: Record<string, unknown>;
  input: unknown;
  /** A previous run's recorded outputs: the "test" button replays without host calls. */
  replay?: Recorded;
}

export default defineSkill({
  tools: {
    run: {
      description: "Runs a swarmpress.tool.v1 graph; the graph and its types are the call's data.",
      input: { type: "object" },
      async run(arg: RunArg, ctx: HostContext): Promise<RunResult> {
        return await runGraph(arg.graph, TypeRegistry.withSite(arg.types), arg.input, contextHost(ctx), {
          clock: () => Date.now(),
          ...(arg.replay ? { replay: arg.replay } : {}),
        });
      },
    },
  },
});
