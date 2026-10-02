/**
 * The MVP article script (docs/mvp.md): the replies a scripted model gives
 * for one standup → draft → review 6 → revision → review 8 loop. It is the
 * TypeScript port of `script()` in `crates/orchestrator/tests/loop.rs`, used
 * by `?llm=fake` (a scripted LocalLlm) and by the orchestrator-wasm Bun test.
 *
 * Call order (one entry per `agents::Llm` call):
 * 0. standup moderator: pick Giulia (structured)
 * 1. Giulia's pitch (generate)
 * 2. moderator: done (structured)
 * 3. meeting outcome with one brief (structured)
 * 4. draft 0 (structured page)
 * 5. review: needs_changes, 6
 * 6. draft 1, the revision (its prompt carries the review notes)
 * 7. review: approve, 8
 */

export type MvpReply = { text: string } | { json: unknown }

function page(paragraph: string) {
  return {
    id: 'ignored-by-orchestrator',
    slug: { en: '/en/blog/x' },
    title: { en: 'Harvest week in Manarola' },
    page_type: 'blog-article',
    seo: { title: 'Harvest week in Manarola', description: 'Picking Sciacchetrà grapes on the terraces.' },
    body: [
      { type: 'heading', level: 2, text: 'On the terraces' },
      { type: 'paragraph', markdown: paragraph },
      { type: 'callout', style: 'info', content: 'The harvest moves with the weather; check before you go.' },
    ],
  }
}

function review(decision: string, score: number, notes: string) {
  return { decision, score, notes, issues: [], high_risk: [] }
}

/** The review note the revision prompt must carry. */
export const MVP_REVIEW_NOTE = 'Tell us who the pickers are.'

/** The plan thread the loop produces for its work item, oldest first. */
export const MVP_POST_TYPES = [
  'minutes',
  'artifact',
  'handoff',
  'review',
  'artifact',
  'handoff',
  'review',
  'artifact',
  'status',
] as const

export function mvpScript(): MvpReply[] {
  return [
    { json: { next: 'staff-1', prompt: 'Giulia, your pitch?', done: false } },
    { text: 'The Sciacchetrà harvest starts Monday; I want to be on the Manarola terraces.' },
    { json: { next: 'staff-1', prompt: '', done: true } },
    {
      json: {
        briefs: [
          {
            title: 'Harvest week in Manarola',
            angle: 'A day on the terraces with the pickers',
            assignee: 'staff-1',
            keywords: ['sciacchetrà', 'manarola harvest'],
            target_words: 600,
          },
        ],
        decisions: ['Giulia covers the harvest'],
        escalations: [],
      },
    },
    { json: page('We climbed to the terraces at seven, before the sun reached the vines.') },
    { json: review('needs_changes', 6, MVP_REVIEW_NOTE) },
    { json: page('Maria and her sons have picked these terraces for thirty years; we joined them at seven.') },
    { json: review('approve', 8, 'Now it has people in it.') },
  ]
}

/** The script as model text (what a LocalLlm would emit), for FakeLlm. */
export function mvpScriptText(): string[] {
  return mvpScript().map((r) => ('text' in r ? r.text : JSON.stringify(r.json)))
}

/** The MVP team, as the sim staffs it (StaffRef JSON). */
export const MVP_TEAM = [
  { id: 'staff-4', persona: 'sophia', role: 'editor-in-chief' },
  { id: 'staff-5', persona: 'marco', role: 'editor' },
  { id: 'staff-1', persona: 'giulia', role: 'writer' },
  { id: 'staff-2', persona: 'isabella', role: 'writer' },
]
