/**
 * eval.html: the eval harness that qualifies the article pipeline before it
 * goes live (FEAT-036, ADR-0057, ADR-0058; docs/design/mvp-pipeline.md §9,
 * docs/runbooks/eval.md). Built only with `vite build --mode harness`.
 *
 * It loads a site pack (`cargo xtask site-pack <site> --articles --out <file>`),
 * opens one local model backend, and runs `runEval` (src/harness/eval/runner.ts)
 * through orchestrator-wasm with an in-memory store and a local gateway:
 * nothing leaves the machine. The page then lists every generated article for
 * the owner to read and mark (saved in localStorage, exportable as JSON).
 *
 * URL parameters:
 *   llm=fake|bonsai|chrome|transformers   the backend (required; never switched)
 *   n=N                                    briefs (default 20, the §9 minimum)
 *   pack=fixture|<url>                     the site pack (default: the committed cinqueterre-mini
 *                                          fixture; the owner's real pack is loaded with the file
 *                                          button or `window.__eval.loadPack(text)`)
 *   timeout=MIN                            per job, minutes (default 60; 1 on fake)
 *   controls=0, seeded=0                   skip the positive controls / the seeded-bad drafts
 *   autostart=1                            start once the pack is loaded (not for a cold Chrome start)
 */
import { BACKENDS, BackendUnavailableError, backendFromQuery, openBackend, type BackendFactories, type BackendId } from '../llm/backend'
import { ChromePromptLlm, CHROME_MODEL_ID } from '../llm/chrome-prompt-llm'
import { LlmClient } from '../llm/client'
import type { LocalLlm } from '../llm/types'
import { DEFAULT_REGISTRY } from '../llm/registry.default'
import { createOrchestrator, fakeMvpLlm, localLlmBridge, type LlmCallRecord, type SiteBindingJson } from '../orchestrator'
import { parseSitePack, pickBriefs, type EvalSite } from './eval/briefs'
import { LocalGateway, MemoryOrchestratorStore, shortHash } from './eval/local'
import { overallVerdict, summarize, thresholdRows, type OwnerMark, type OwnerMarks } from './eval/metrics'
import { articleBlocks, articleText, articleTitle, evalBenchmarkDoc, evalMarkdown } from './eval/report'
import { Meter, runEval, truncatedAnswer, MAX_REVISIONS, QUALITY_BAR, type ArticleResult, type EvalConfig, type EvalOrchestrator, type EvalProgress, type EvalResults } from './eval/runner'

const $ = (id: string) => document.getElementById(id) as HTMLElement
const params = new URLSearchParams(location.search)

function num(name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name)
  if (raw === null || raw === '') return fallback
  const v = Number(raw)
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`?${name}=${raw}: expected a number from ${min} to ${max}`)
  return v
}

function readConfig(): EvalConfig {
  const backend = backendFromQuery(location.search)
  if (!backend) throw new Error(`choose a backend with ?llm= (${Object.keys(BACKENDS).join(', ')})`)
  return {
    backend,
    modelId: backend === 'fake' ? 'fake-mvp' : backend === 'chrome' ? CHROME_MODEL_ID : BACKENDS[backend].modelId,
    n: Math.floor(num('n', 20, 1, 200)),
    bar: QUALITY_BAR,
    maxRevisions: MAX_REVISIONS,
    jobTimeoutMs: num('timeout', backend === 'fake' ? 1 : 60, 0.01, 24 * 60) * 60_000,
    controls: params.get('controls') !== '0',
    seeded: params.get('seeded') !== '0',
  }
}

/** The binding of the site in the pack (the brand of cinqueterre.travel; the pack's own files for style and voice). */
function binding(site: EvalSite): SiteBindingJson {
  return {
    site_id: 'cinqueterre.travel',
    brand_name: 'Cinque Terre Dispatch',
    language: 'en',
    knowledge_pack: site.packJson,
    quality_bar: QUALITY_BAR,
    simulate_deploy: false,
    standup_max_turns: 4,
    seo_suffix: 'The Dispatch',
  }
}

function factories(backend: BackendId, onEvent: (kind: string, message: string) => void): BackendFactories {
  switch (backend) {
    case 'fake':
      return { fake: () => fakeMvpLlm() }
    case 'chrome':
      return { chrome: () => new ChromePromptLlm() }
    default:
      return { [backend]: () => LlmClient.spawn({ registry: DEFAULT_REGISTRY, onEvent: (e) => onEvent(e.kind, e.message) }) }
  }
}

// ---------------------------------------------------------------- the owner's marks

const marksKey = (commit: string) => `swarmpress.eval.marks.${commit}`
/** A mark belongs to one article text: a re-run that writes another article starts unmarked. */
const markId = (a: ArticleResult) => `${a.id}@${shortHash(JSON.stringify(a.page ?? null))}`

function loadMarks(commit: string): Record<string, OwnerMark> {
  try {
    return JSON.parse(localStorage.getItem(marksKey(commit)) ?? '{}') as Record<string, OwnerMark>
  } catch {
    return {}
  }
}

function saveMarks(commit: string, marks: Record<string, OwnerMark>): void {
  try {
    localStorage.setItem(marksKey(commit), JSON.stringify(marks))
  } catch {
    /* private window: the marks live as long as the page */
  }
}

/** The stored marks keyed by article id, for the articles of this run. */
function marksFor(res: EvalResults, stored: Record<string, OwnerMark>): OwnerMarks {
  const out: OwnerMarks = {}
  for (const a of res.articles) {
    const m = stored[markId(a)]
    if (m) out[a.id] = m
  }
  return out
}

// ---------------------------------------------------------------- rendering

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  for (const c of children) e.append(c)
  return e
}

function renderText(page: unknown): HTMLElement {
  const box = el('div', { class: 'text' })
  for (const b of articleBlocks(page)) {
    switch (b.kind) {
      case 'title':
        box.append(el('h3', {}, b.text))
        break
      case 'dek':
        box.append(el('p', { class: 'dek' }, b.text))
        break
      case 'heading':
        box.append(el('h4', {}, b.text))
        break
      case 'list':
        box.append(el('ul', {}, ...(b.items ?? []).map((i) => el('li', {}, i))))
        break
      case 'tip':
        box.append(el('p', { class: 'tip' }, `Tip: ${b.text}`))
        break
      case 'closing':
      case 'link':
        box.append(el('p', { class: 'closing' }, b.text))
        break
      case 'image':
        box.append(el('p', { class: 'muted' }, `(${b.text})`))
        break
      default:
        box.append(el('p', {}, b.text))
    }
  }
  return box
}

function renderArticle(a: ArticleResult, mark: OwnerMark | undefined, onMark: (m: OwnerMark) => void): HTMLElement {
  const last = a.reviews[a.reviews.length - 1]
  const meta = [
    `${a.kind}${a.seedKind ? ` · ${a.seedKind}` : ''} · ${a.outcome}${a.reason ? ` (${a.reason})` : ''}`,
    `scores ${a.reviews.map((r) => `r${r.revision}: ${r.score}`).join(', ') || '—'}`,
    a.checks ? `words ${a.checks.words} of ${a.checks.target_words} (${a.checks.words_percent}%)` : '',
    `${Math.round(a.wallMs / 1000)} s`,
  ].filter(Boolean)
  const issues = el('ul', {}, ...(last?.issues ?? []).map((i) => el('li', {}, `[${i.section}] ${i.problem}${i.fix ? ` → ${i.fix}` : ''}`)))
  const checks = a.checks
    ? [...a.checks.banned_phrases.map((p) => `banned phrase: ${p}`), ...a.checks.plain_text_findings, ...a.checks.site_issues, ...a.checks.gateway_issues.filter((i) => !a.checks!.site_issues.includes(i))]
    : []
  const node = el(
    'article',
    { 'data-id': a.id, 'data-kind': a.kind, 'data-outcome': a.outcome },
    el('div', { class: 'meta' }, meta.join(' · ')),
    renderText(a.page),
    el('div', { class: 'meta' }, `Editor: ${last?.notes || '—'}`),
    issues,
    el('details', {}, el('summary', {}, `Checks (${checks.length} problems)`), el('pre', {}, [...(a.checks?.measured ?? []), ...checks].join('\n') || 'no checks')),
  )
  if (a.kind === 'brief' && a.page) {
    const publish = el('input', { type: 'checkbox' }) as HTMLInputElement
    publish.checked = mark?.publish === true
    const reject = el('input', { type: 'checkbox' }) as HTMLInputElement
    reject.checked = mark?.publish === false
    const wrong = el('input', { type: 'checkbox' }) as HTMLInputElement
    wrong.checked = mark?.factualError === true
    const note = el('input', { type: 'text', placeholder: 'note (optional)' }) as HTMLInputElement
    note.value = mark?.note ?? ''
    const save = () => onMark({ publish: publish.checked ? true : reject.checked ? false : null, factualError: wrong.checked, ...(note.value ? { note: note.value } : {}) })
    publish.addEventListener('change', () => {
      if (publish.checked) reject.checked = false
      save()
    })
    reject.addEventListener('change', () => {
      if (reject.checked) publish.checked = false
      save()
    })
    wrong.addEventListener('change', save)
    note.addEventListener('change', save)
    node.append(el('div', { class: 'marks' }, el('label', {}, publish, ' would publish'), el('label', {}, reject, ' would not publish'), el('label', {}, wrong, ' factually wrong'), note))
  }
  return node
}

function renderSummary(res: EvalResults, marks: OwnerMarks): void {
  const s = summarize(res, marks)
  const rows = thresholdRows(s, res)
  const verdict = overallVerdict(rows)
  document.body.dataset.verdict = verdict
  const table = el(
    'table',
    {},
    el('tr', {}, ...['#', 'metric', 'bar', 'measured', 'verdict'].map((h) => el('th', {}, h))),
    ...rows.map((r) => el('tr', { 'data-row': r.id }, el('td', {}, String(r.rule || '–')), el('td', {}, r.metric), el('td', {}, r.bar), el('td', {}, r.measured), el('td', { class: r.verdict }, r.verdict))),
  )
  const box = $('summary')
  box.replaceChildren(el('h2', {}, 'Threshold'), el('p', {}, 'Verdict: ', el('strong', { class: verdict }, verdict.toUpperCase()), verdict === 'pending' ? ' (read and mark every approved article below)' : ''), table)
  if (res.errors.length) box.append(el('h2', {}, 'Errors'), el('pre', {}, res.errors.join('\n')))
}

// ---------------------------------------------------------------- the page

declare global {
  interface Window {
    __eval?: {
      config: EvalConfig | null
      error: string | null
      /** Loads a site pack document (its JSON text) in place of the default. */
      loadPack(text: string): void
      start(): Promise<EvalResults>
      progress(): EvalProgress | null
      results(): EvalResults | null
      /** The owner's marks for this run's articles, by article id. */
      marks(): OwnerMarks
      setMark(articleId: string, mark: OwnerMark): void
      /** Resolves with the results when the run ends. */
      done(): Promise<EvalResults>
    }
  }
}

function boot(): void {
  let config: EvalConfig | null = null
  let error: string | null = null
  try {
    config = readConfig()
  } catch (e) {
    error = (e as Error).message
  }
  let site: EvalSite | null = null
  /** The site commit the marks are kept under (the pack's, or the viewed results'). */
  let commit = ''
  let running: Promise<EvalResults> | null = null
  let results: EvalResults | null = null
  let progress: EvalProgress | null = null
  let stored: Record<string, OwnerMark> = {}
  let resolveDone: (r: EvalResults) => void = () => {}
  const done = new Promise<EvalResults>((r) => (resolveDone = r))
  const status = (text: string) => ($('status').textContent = text)

  const showConfig = () => {
    if (!config) return
    const picked = site ? pickBriefs(site.pack, config.n) : null
    $('config').textContent = [
      `backend: ${BACKENDS[config.backend as BackendId].label}${config.modelId ? ` (${config.modelId})` : ''}`,
      site ? `site pack: commit ${site.pack.commit} · ${site.pack.pages.length} pages · ${Object.keys(site.articles).length} articles` : 'site pack: not loaded',
      picked ? `briefs: ${picked.briefs.length} of ${picked.available} unpublished calendar topics (${picked.published.length} published topics skipped)` : '',
      `editor: bar ${config.bar}, at most ${config.maxRevisions} revisions · job timeout ${Math.round(config.jobTimeoutMs / 60000)} min`,
      `positive controls: ${config.controls ? 'yes' : 'no'} · seeded-bad drafts: ${config.seeded ? 'yes' : 'no'}`,
      `cross-origin isolated: ${globalThis.crossOriginIsolated === true}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** Shows exported results (`Export JSON`, or the raw file of e2e/eval.spec.ts) for reading and marking; no run. */
  const view = (r: EvalResults, marks: OwnerMarks) => {
    results = r
    commit = r.site.commit
    stored = loadMarks(commit)
    for (const a of r.articles) if (marks[a.id] && !stored[markId(a)]) stored[markId(a)] = marks[a.id]
    saveMarks(commit, stored)
    ;($('start') as HTMLButtonElement).disabled = true
    document.body.dataset.eval = 'done'
    status(`viewing the results of ${r.startedAt} (${r.config.backend}, ${r.articles.length} articles); marks are saved in this browser`)
    render()
    resolveDone(r)
  }

  const loadPack = (text: string) => {
    if (running) throw new Error('the run has started; reload the page to change the pack')
    const doc = JSON.parse(text) as { schema?: string; results?: EvalResults; marks?: OwnerMarks }
    const exported = doc?.schema === 'swarmpress.eval.v1' ? (doc as unknown as EvalResults) : doc?.results?.schema === 'swarmpress.eval.v1' ? doc.results : null
    if (exported) return view(exported, doc.marks ?? {})
    site = parseSitePack(text)
    commit = site.pack.commit
    stored = loadMarks(commit)
    showConfig()
    ;($('start') as HTMLButtonElement).disabled = !config
    document.body.dataset.eval = 'ready'
    status('ready')
  }

  const render = () => {
    if (!results) return
    const marks = marksFor(results, stored)
    renderSummary(results, marks)
    const box = $('articles')
    const groups: [string, ArticleResult['kind']][] = [
      ['Generated articles: read each one and mark it', 'brief'],
      ['The site’s own articles (positive controls)', 'control'],
      ['Seeded-bad drafts', 'seeded'],
    ]
    box.replaceChildren()
    for (const [title, kind] of groups) {
      const list = results.articles.filter((a) => a.kind === kind)
      if (!list.length) continue
      box.append(el('h2', {}, title))
      for (const a of list) {
        box.append(
          renderArticle(a, stored[markId(a)], (m) => {
            stored[markId(a)] = m
            saveMarks(commit, stored)
            renderSummary(results!, marksFor(results!, stored))
          }),
        )
      }
    }
    const ctx = {
      provenance: { commit: null, branch: null, dirty: null, generatedAt: new Date().toISOString() },
      machine: { slug: 'this-machine', os: navigator.platform, arch: 'unknown', cpus: navigator.hardwareConcurrency ?? 0, cpuModel: 'this machine', memoryGb: 0 },
    }
    const link = (id: string, name: string, text: string, type: string) => {
      const a = $(id) as HTMLAnchorElement
      a.href = URL.createObjectURL(new Blob([text], { type }))
      a.download = name
      a.hidden = false
    }
    link('doc', `agent-pipeline-eval-${results.config.backend}.json`, `${JSON.stringify(evalBenchmarkDoc(results, ctx), null, 2)}\n`, 'application/json')
    link('record', `eval-${results.config.backend}.md`, evalMarkdown(results, ctx, marks), 'text/markdown')
    $('export').hidden = false
  }

  const start = async (): Promise<EvalResults> => {
    if (running) return running
    if (!config) throw new Error(error ?? 'no configuration')
    if (!site) throw new Error('load a site pack first')
    const cfg = config
    const s = site
    ;($('start') as HTMLButtonElement).disabled = true
    document.body.dataset.eval = 'running'
    running = (async () => {
      const picked = pickBriefs(s.pack, cfg.n)
      if (picked.briefs.length < cfg.n) status(`only ${picked.briefs.length} unpublished topics in the calendar`)
      status(`opening ${BACKENDS[cfg.backend as BackendId].label}`)
      let opened
      try {
        opened = await openBackend(cfg.backend as BackendId, factories(cfg.backend as BackendId, (k, m) => console.info(`[llm] ${k}: ${m}`)))
      } catch (e) {
        if (e instanceof BackendUnavailableError) throw new Error(`${e.message} (the harness never switches to another backend)`)
        throw e
      }
      const llm: LocalLlm = opened.llm
      await llm.load(cfg.modelId ?? 'fake-mvp', (p) => status(`loading ${p.modelId}: ${p.phase} ${Math.round((p.fraction ?? 0) * 100)}%`))
      const meter = new Meter()
      const bridge = localLlmBridge(llm)
      // Every answer passes here: its cost comes from the bridge's record, truncation is read off the answer.
      let record: LlmCallRecord | null = null
      bridge.onCall = (rec) => (record = rec)
      const metered = {
        useValidator: bridge.useValidator,
        async complete(requestJson: string): Promise<string> {
          record = null
          const out = await bridge.complete(requestJson)
          // Set by the bridge's onCall during the await (control flow cannot see it).
          const rec = record as LlmCallRecord | null
          if (rec) meter.call(rec, truncatedAnswer(out))
          return out
        },
      }
      const store = new MemoryOrchestratorStore()
      let handle: EvalOrchestrator | null = null
      const gateway = new LocalGateway((contentId, path, pageJson) =>
        JSON.parse(handle!.evalOp('gateway_checks', JSON.stringify({ content_id: contentId, path, page: JSON.parse(pageJson) }))) as string[],
      )
      // The memory store answers synchronously; orchestrator-wasm takes a value or a Promise.
      const asStore = store as unknown as Parameters<typeof createOrchestrator>[0]['store']
      handle = (await createOrchestrator({ store: asStore, gateway, llm: metered, site: binding(s), onProgress: (ev) => meter.progress(ev) })) as unknown as EvalOrchestrator
      const r = await runEval({
        orch: handle,
        store,
        gateway,
        meter,
        site: s,
        briefs: picked.briefs,
        topicsAvailable: picked.available,
        published: picked.published,
        config: cfg,
        onProgress: (p) => {
          progress = p
          status(`${p.phase}: ${p.done} of ${p.total} done${p.current ? ` · ${p.current} · ${p.stage}` : ''}`)
        },
      })
      results = r
      await llm.dispose().catch(() => undefined)
      status(`done: ${r.articles.length} articles in ${Math.round((Date.parse(r.finishedAt ?? '') - Date.parse(r.startedAt)) / 1000)} s${r.errors.length ? ` · ${r.errors.length} errors` : ''}`)
      document.body.dataset.eval = 'done'
      render()
      resolveDone(r)
      return r
    })()
    running.catch((e: unknown) => {
      error = (e as Error)?.message ?? String(e)
      window.__eval!.error = error
      status(`failed: ${error}`)
      document.body.dataset.eval = 'failed'
    })
    return running
  }

  window.__eval = {
    config,
    error,
    loadPack,
    start,
    progress: () => progress,
    results: () => results,
    marks: () => (results ? marksFor(results, stored) : {}),
    setMark: (articleId, mark) => {
      const a = results?.articles.find((x) => x.id === articleId)
      if (!a) throw new Error(`no article ${articleId} in this run`)
      stored[markId(a)] = mark
      saveMarks(commit, stored)
      render()
    },
    done: () => done,
  }

  $('start').addEventListener('click', () => void start().catch((e) => console.error(e)))
  $('export').addEventListener('click', () => {
    if (!results) return
    const marks = marksFor(results, stored)
    const s = summarize(results, marks)
    const blob = new Blob([`${JSON.stringify({ results, marks, summary: s, rows: thresholdRows(s, results), articles: results.articles.filter((a) => a.kind === 'brief').map((a) => ({ id: a.id, title: articleTitle(a), text: articleText(a.page) })) }, null, 2)}\n`], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `eval-${results.config.backend}-${results.site.commit.slice(0, 7)}.json`
    a.click()
  })
  ;($('pack-file') as HTMLInputElement).addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      loadPack(await file.text())
    } catch (e) {
      status(`could not load ${file.name}: ${(e as Error).message}`)
    }
  })

  if (error) {
    status(error)
    document.body.dataset.eval = 'failed'
    return
  }
  showConfig()
  const source = params.get('pack') ?? 'fixture'
  const text =
    source === 'fixture'
      ? import('./fixtures/cinqueterre-mini.eval.json?raw').then((m) => m.default)
      : fetch(source).then((r) => {
          if (!r.ok) throw new Error(`${source}: HTTP ${r.status}`)
          return r.text()
        })
  text.then(
    (t) => {
      // A pack (or results) loaded by hand or by the spec before the default arrived wins.
      if (!site && !results) loadPack(t)
      if (params.get('autostart') === '1') void start().catch((e) => console.error(e))
    },
    (e: unknown) => {
      status(`could not load the site pack: ${(e as Error).message}`)
      document.body.dataset.eval = 'failed'
    },
  )
}

boot()
