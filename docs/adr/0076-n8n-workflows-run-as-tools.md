# ADR-0076 — n8n workflows run as tools

**Status:** Accepted (supersedes in part ADR-0072: the "no free-code node" rule and the 12-node limit)
**Date:** 2026-10-08

## Context

ADR-0072 made a site's tools typed graphs over a closed node catalogue. Its n8n import (FEAT-096)
translated a handful of n8n nodes into that catalogue and sealed everything else, Code included. On
2026-10-08 the owner asked for more: **the tools have to be compatible with n8n, so existing n8n flows
can be reused.** The scope is import only (no export back to n8n), and n8n Code nodes run in the
sandbox.

Translation was the wrong tool for that:
- **Item semantics.** n8n nodes work on lists of items: an IF splits items between its two outputs,
  and an empty output does not run what follows it. Our ops passed whole values, so an imported IF
  read a field of the list rather than of each item.
- **Expressions.** Real flows use n8n expressions everywhere (`{{ $json.email.toLowerCase() }}`,
  `$('Other node').item.json.x`, `$now.toFormat(…)`); only plain field reads translated.
- **Code.** Code nodes are in most real flows, and ADR-0072 refused them.
- **Requests.** n8n flows POST, PUT and DELETE, send JSON bodies and headers, and sign in with
  credentials; the proxy and the connectors could only GET.
- **Size.** Real flows are larger than ADR-0072's 12-node limit.

## Decision

1. **An `n8n` node kind.** A tool graph may hold `n8n` nodes. Each one is an n8n node kept as it is:
   name, type, version and parameters unchanged, plus its input and output counts, an optional
   credential name, the site tool an Execute Workflow calls, and "continue on fail". The importer maps
   a workflow node for node. The interpreter runs these nodes with n8n's item semantics: per-item
   parameters, outputs that do not run when empty, and `$('Name')` over the nodes that ran before.
2. **A closed list of n8n types.** 26 types run: HTTP Request, RSS Read, Edit Fields (Set), IF,
   Filter, Switch, Merge, Limit, Sort, Remove Duplicates, Split Out, Aggregate, Summarize, Item Lists,
   Rename Keys, Date & Time, Code, Function, Function Item, No Op, Wait, Stop and Error, Respond to
   Webhook, Execute Workflow, Basic LLM Chain and OpenAI "Message a model". Rust (`N8N_TYPES`) and
   TypeScript (`catalogue.ts`) keep the same list, and a test compares them.
   - Every other type stays in the graph as a sealed step, and so do shapes of these types that cannot
     run (Python, pagination, binary data, a Wait for a webhook). The checker refuses them, so the tool
     cannot be installed until the step is replaced (rule 11).
   - Triggers become the tool's triggers. A webhook becomes an input named `request`.
   - Loop Over Items is flattened (a tool processes all items at once), and model sub-nodes are
     dropped (the hosted model stands in for them).
3. **n8n JavaScript runs in a nested sandbox with no capabilities.** Code, Function and Function Item
   nodes, every expression that is more than a field read, the Date & Time node and a sort comparator
   run through a new SDK capability, `code`:
   - `swarmpress.code.run(program, arg)` evaluates a program in a fresh QuickJS sandbox. That sandbox
     has no capabilities: no fetch, no model, no store and no modules.
   - It runs under the caller's memory, ops and remaining wall-time budget.
   - The program is the reviewed n8n prelude: `$json`, `$input`, `$('Node')`, a UTC subset of Luxon's
     `DateTime`, and n8n's string, number, array and object helpers.
   - `$env`, `require` and `this.helpers` fail with a reason.
   - Plain field reads (`$json.a.b`) are evaluated natively and never reach the sandbox.
   - Every tool with an n8n node is granted `code`. Rule 14 holds: all extension code still runs in
     QuickJS, now one level deeper.
4. **Requests through the proxy, with any method.** `POST /web/request` is the fetch proxy for tools:
   - GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS, with headers and a body of at most 256 KiB;
   - the answer comes back raw (no HTML reduction);
   - redirects are followed for GET and HEAD only;
   - `Host`, `Cookie`, hop-by-hop headers and the credential header are never forwarded;
   - the SSRF guard, the rate limit, the size cap and the content-type rules of `/web/fetch` apply
     unchanged.
5. **Reach is declared, and may be "any website".** The manifest lists each request's literal origin.
   A URL whose host is computed by an expression makes the manifest grant `web` with no origin list:
   the tool may reach any public website, still through the proxy's guard. The CEO sees this before
   installing ("from any public website"). An n8n model step grants `llm:mid`.
6. **Credentials stay on the player's device** (ADR-0054, built here for tools).
   - A node names its credential.
   - Inside the sandbox, only the name exists (`X-SwarmPress-Credential`).
   - The browser's tool runner swaps the name for the secret outside the sandbox, before the request
     leaves for the proxy. A credential signs with a header, a query parameter, a bearer token or
     basic auth.
   - The secret is kept in this browser's storage only: not in the site repo, the command log or sync.
   - A credential that is not set up fails the request loudly.
7. **Limits.**
   - A graph may hold 40 nodes (it was 12).
   - Without explicit limits, each n8n request or model node may make 50 calls per run, times
     `1 + retries`.
   - An output whose type is optional (`Json[]?`) may stay unwritten, because n8n branches need not
     run. A required one that stays unwritten still fails the run.
8. **Types.** A built-in `Json` type (any JSON value) is what n8n nodes pass on. Every type fits
   `Json`, and `Json` fits only itself, so binding an n8n tool's output to a block still needs a
   declared type (`returns` on the node).

## Consequences

- **Real flows run as they are**, with their expressions and Code. The tests run them that way: a
  webhook lead intake (expressions, a JSON POST, IF v2 over another node's item, Code per item,
  merge, response), and a trail roundup (split, filter, sort, the flattened loop, aggregate, the
  hosted model, Code with `$now`). They run under Bun and in the browser, and replays reuse the
  recorded requests, model replies and code.
- **The closed world holds where it matters.** The node list is closed, the checker refuses what
  cannot run, and the code sandbox reaches nothing. Requests go through the guarded proxy and the
  manifest the CEO approves. The world is not closed inside Code: it is arbitrary JavaScript over the
  items, which is what the owner asked for.
- **Negatives.**
  - **Not exact.** Behaviour can differ from n8n in places: time is UTC, Luxon is a subset, and a
    loop's batches become one pass. A strict type mismatch in a condition compares loosely instead of
    failing. Binary data, pagination, Python, the HTML and XML nodes and LangChain agents with tools
    do not run.
  - **Integration nodes.** Slack, Google Sheets and the rest stay sealed. They can be rebuilt with
    HTTP Request and a credential.
  - **"Any website" is broad.** It is visible at install, but it is a weaker promise than a list of
    origins.
  - **Credentials pass through the server.** They live in the browser and cross the proxy in
    headers. The server keeps nothing, but it does see them in flight.
  - **Cost and size.** The nested sandbox instantiates QuickJS per call (a few milliseconds). The
    tool runtime bundle grew from about 45 KB to 125 KB, because the n8n prelude and nodes ship in
    it.
- **Alternatives rejected.**
  - **Running n8n itself** (as a service or embedded) adds infrastructure that rule 13 forbids, and
    puts a second engine outside the sandbox.
  - **Translating into the native catalogue only** cannot express item semantics or expressions.
  - **Evaluating Code in the interpreter's own sandbox** would let Code call the tool's fetch and
    model directly, past the trace, the replay and the run limits.
  - **Export back to n8n** is not wanted (owner, 2026-10-08).
