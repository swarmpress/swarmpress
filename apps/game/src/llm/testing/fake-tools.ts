/**
 * The tools the fake Web Developer builds (FEAT-095), the twins of
 * `agents::fake_writer::FAKE_FERRY_TOOL` and `FAKE_PAGES_TOOL`. Kept apart
 * from the model's backend modules: the ferry tool names its timetable's
 * origin, and the backends name no URL (`local-only.test.ts`).
 */

/** `agents::fake_writer::FAKE_FERRY_TOOL`: the ferry tool, when the site has its types. */
export const FAKE_FERRY_TOOL = {
  format: 'swarmpress.tool.v1',
  id: 'ferry-times',
  name: { en: 'Ferry departures' },
  description: "The next ferry departures from a village's pier.",
  inputs: { village: 'Village' },
  outputs: { departures: 'FerryDeparture[]' },
  nodes: [
    { id: 'in', kind: 'input', port: 'village' },
    { id: 'fetch', kind: 'connector', connector: 'http-get', url: 'https://www.navigazionegolfodeipoeti.it/orari.json', returns: 'FerryTimetable' },
    { id: 'rows', kind: 'op', op: 'pick', path: '$.departures', returns: 'FerryRow[]' },
    { id: 'here', kind: 'op', op: 'filter', where: { path: '$.stop', cmp: 'eq', value: '$param.slug' } },
    { id: 'shape', kind: 'op', op: 'map', fields: { time: '$.dep', to: '$.dest' }, returns: 'FerryDeparture[]' },
    { id: 'first', kind: 'op', op: 'limit', count: 6 },
    { id: 'out', kind: 'output', port: 'departures' },
  ],
  edges: [
    ['fetch.out', 'rows.in'],
    ['rows.out', 'here.in'],
    ['in.out', 'here.param'],
    ['here.out', 'shape.in'],
    ['shape.out', 'first.in'],
    ['first.out', 'out.in'],
  ],
  triggers: [{ kind: 'schedule', every_game_days: 1 }, { kind: 'build' }],
  failure: { retries: 1, on_error: 'keep-last' },
  limits: { fetches_per_run: 1 },
}

/** `agents::fake_writer::FAKE_PAGES_TOOL`: the newest pages from the knowledge pack, built-in types only. */
export const FAKE_PAGES_TOOL = {
  format: 'swarmpress.tool.v1',
  id: 'latest-pages',
  name: { en: 'Latest pages' },
  description: "The site's newest pages, from its knowledge pack.",
  inputs: {},
  outputs: { pages: 'Page[]' },
  nodes: [
    { id: 'read', kind: 'connector', connector: 'knowledge', query: 'pages', returns: 'Page[]' },
    { id: 'first', kind: 'op', op: 'limit', count: 6 },
    { id: 'out', kind: 'output', port: 'pages' },
  ],
  edges: [
    ['read.out', 'first.in'],
    ['first.out', 'out.in'],
  ],
  triggers: [{ kind: 'on-demand' }],
}
