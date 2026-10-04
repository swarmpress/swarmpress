# Check calibration on the live articles

> FEAT-036 (the eval), FEAT-031 (house style), ADR-0058, ADR-0061;
> [`docs/design/mvp-pipeline.md`](../design/mvp-pipeline.md) section 9 ("the 19 existing articles
> calibrate the checks and act as positive controls"). Site commit `2d5683cc37a7` of
> cinqueterre.travel, 19 articles under `content/pages/blog/`. Measured on 2026-10-04.

## The question

The first eval run on the owner's site clone showed the site's own 19 published articles failing the
checks: banned phrases 4, site validator 10, links and media 6, gateway 6 (create-only left out).
Either the checks are miscalibrated, or the live articles break rules that new articles must follow.
Each failure was traced to its issue and classified:

- **(a)** a check bug or an over-strict rule: fixed in the checks;
- **(b)** a rule new articles must follow and legacy articles may break: the rule stays, and the
  eval scores the controls on a **legacy profile** that names the exception;
- **(c)** a data problem in the site: listed below for the owner. The site repository was not
  touched.

## Result

A control is the article as the eval reads it (`orchestrator::eval::reference_article`: its text
re-assembled in the article profile, so the editor reads it exactly as it reads a draft) and then
checked with `eval_checks`. Counts are articles out of 19.

| check | before (`1fe32a6`) | after |
|---|---|---|
| banned-phrases | 4 | 6 (the plural fix finds 2 more) |
| site-validator | 10 | 12 (the same 6 banned + 6 media) |
| links-and-media | 6 | 6 |
| gateway (create-only left out) | 6 | 6 |
| **rules broken** (new; each once per article) | not reported | banned-phrase 6, media 6 |
| controls outside the legacy profile (new) | not reported | **0** |
| calibration row (new, threshold 5) | not reported | **pass**, 19 of 19 |

The old counts made one problem look like several: a hero image outside the media index failed
links-and-media, the site validator and the gateway (three checks, one cause), and a banned phrase
failed banned-phrases and the site validator. There are 12 articles with one rule broken each and
7 clean ones; no article breaks a rule outside `banned-phrase` and `media`.

The eval on the real pack with the scripted model (local, `EVAL_PACK=… pnpm exec vitest run
src/harness/eval`): committed drafts passing the gateway 6 of 6, seeded-bad drafts rejected 6 of 6
(checks alone 6), calibration 19 of 19 on the legacy profile. The editor's controls row (0 of 19)
is the scripted editor, which scores every first read 6.

### Per article

Rules are `EvalChecks.rules` (`orchestrator::eval::RULES`); create-only is left out (every control
is on the site already).

| article | rules | issue (code, pointer) |
|---|---|---|
| 5-hidden-gelaterias-you-need-to-try | banned-phrase | `house_style` "tourist trap" (as "tourist traps") in the subtitle `/body/0/subtitle` (and in the closing, for which the reading uses the subtitle) |
| a-photographers-guide-to-manarola-at-sunset | – | |
| best-time-to-visit-and-when-to-skip | banned-phrase | `house_style` "hidden gem" in a section heading (`[s3] /body/6/text`) |
| cinque-terre-by-boat-kayaking-and-water-adventures | – | |
| day-trip-to-portovenere | media | `media` `/body/0/image`: hero `photo-1533104816931` not in the media index |
| hidden-gems-corniglias-quiet-streets | banned-phrase | `house_style` "hidden gem" (as "Hidden Gems") in the title `/body/0/title` |
| hiking-the-blue-trail-what-to-expect | banned-phrase | `house_style` "iconic" in `[s4] /body/9/markdown` |
| last-light-on-sentiero-azzurro | media | `media` `/body/0/image`: hero `mh7-edeyi44-688ff98a.webp` (R2) not in the media index |
| ligurian-food-culture-what-locals-actually-eat | media | `media` `/body/0/image`: hero `photo-1473093295043` not in the media index |
| local-festivals-in-november | media | `media` `/body/0/image`: hero `photo-1551183053` not in the media index |
| local-train-and-ferry-cheatsheet | banned-phrase | `house_style` "stunning" in `[intro] /body/1/markdown` |
| locals-guide-to-vernazza | – | |
| packing-list-what-to-bring-for-a-fall-trip | – | |
| spring-in-cinque-terre-wildflowers-and-easter | – | |
| sustainable-travel-in-cinque-terre | media | `media` `/body/0/image`: hero `photo-1501785888041` not in the media index |
| the-perfect-first-timer-itinerary | banned-phrase | `house_style` "iconic" in `[intro] /body/1/markdown` |
| the-ultimate-guide-to-cinque-terre-wines | media | `media` `/body/0/image`: hero `photo-1551183053` not in the media index |
| the-ultimate-guide-to-cinque-terres-best-beaches | – | |
| where-to-stay-hotel-vs-airbnb | – | |

Every hit was read in context: each banned phrase is the word used as the style guide means it
("the most iconic view", "stunning views", "The Hidden Gem: late October"), and each hero is truly
absent from `content/config/media-index.json`. No check reported something that is not there.

## Classification and decisions

### (a) Check bugs: fixed

1. **A plural dodged a banned phrase.** `StyleGuide::banned_phrase_hits` matched whole words only,
   so "hidden gems" and "tourist traps" passed although "hidden gem" and "tourist trap" are banned.
   Two live articles use the plural, and a model would as easily. The match now accepts a plural
   `s`/`es` on the phrase's last word (`contains_phrase_or_plural`); "gemstones" and "iconically"
   still pass. This makes the gate stricter for new drafts, never looser. Test:
   `crates/agents/tests/prompts.rs` (`house_style_from_cinqueterre_fixture`).
2. **The reference reading lost text.** The theme's `editorial-intro` keeps its text in
   `leftContent`, `rightContent` and `quote`, and `editor-note` in `quote`; the reading looked only
   at `markdown`, `content` and `text`, so the editor read a control without its intro and its
   editor's note. HTML paragraphs (`<p>…</p><p>…</p>`) also ran together into one. Both are read
   now. Test: `the_reference_reading_keeps_the_editorial_intro_and_the_editor_note`
   (`crates/orchestrator/tests/eval.rs`, a synthetic article in that shape).
3. **The calibration line counted causes several times** (see above). `EvalChecks.rules` names
   each broken rule once, whichever checks saw it, and the report and the Cockpit document list
   the rules (`controls.failing_rule`, `controls.outside_legacy`). Test:
   `checks_name_the_rules_an_article_breaks`.

No rule was found over-strict: nothing the checks flag on these articles is something new drafts
should be allowed to do.

### (b) Rules kept; the live articles are known exceptions

The legacy profile is `LEGACY_RULES` in `apps/game/src/harness/eval/metrics.ts`. It applies to the
**positive controls only**: the gateway, the orchestrator's validator and thresholds 1 and 4 for new
drafts are unchanged, and the seeded-bad set is still rejected 6 of 6.

| rule | articles | why legacy may break it | why new drafts may not |
|---|---|---|---|
| `banned-phrase` | 6 | the articles predate the style guide's `vocabulary.avoid` list; the words render fine | the owner's style guide bans them for new writing |
| `media` | 6 | the theme renders any image URL; these heroes were never added to the media index | the closed world (CLAUDE.md rule 5, ADR-0061): a draft may only use indexed media, so the site's index stays the one list of images and their licences |

A control that breaks any other rule fails the new **calibration** row (threshold 5) and is named
in the record ("Outside the legacy profile: …"): that is a check bug or a rule the live site
disagrees with, to settle before going live.

### Theme facts behind the decisions

Read from the frozen theme (`packages/site-builder/src/themes/cinque-terre/`, read only):
`EditorialHero` prints `title` with `set:html`; `ClosingNoteBlock` prints a string `content` with
`set:html` as it is (an array goes through `marked.parseInline`); `EditorialIntroBlock` prints
`leftContent`/`rightContent` with `set:html`; `BlogArticle` prints its text escaped. The live
articles that hold HTML (`<p>` in one article's intro columns and closing note) render correctly.
The article profile still forbids a raw `<` or `>` in the two `set:html` fields of a **draft**:
the orchestrator writes plain text and escapes it, and a model's markup there would be injected
into the page. That rule is not exercised by the controls (the reading re-assembles them as plain
text) and stays.

The live articles also use blocks outside the article profile (`blog-article` in 17,
`editorial-intro` and `editor-note` in one). The theme renders them; new drafts use the assembled
block set of ADR-0061 only. The eval reads both shapes, so this is not a calibration failure.

## (c) For the owner: data problems in the site

Not fixed here (the site repository is read only for this work). Found in the article pages as the
site has them, before the eval's reading:

1. **Hero images missing from `content/config/media-index.json`** (add an entry with tags, licence
   and photographer, or change the hero to an indexed image):
   - `day-trip-to-portovenere`: `images.unsplash.com/photo-1533104816931-20fa691ff6ca`
   - `ligurian-food-culture-what-locals-actually-eat`: `images.unsplash.com/photo-1473093295043-cdd812d0e601`
   - `local-festivals-in-november` and `the-ultimate-guide-to-cinque-terre-wines`:
     `images.unsplash.com/photo-1551183053-bf91a1d81141`, **the same hero for two articles** (also on
     both cards of the blog index)
   - `sustainable-travel-in-cinque-terre`: `images.unsplash.com/photo-1501785888041-af3ef285b470`
   - `last-light-on-sentiero-azzurro`: the R2 image `…/images/stock/unsplash/mh7-edeyi44-688ff98a.webp`
2. **`last-light-on-sentiero-azzurro`, other references:**
   - closing-note actions `/hiking/sentiero-azzurro` and `/stories/hiking` are not pages of the site
     (no language prefix, no such route): likely broken links on the live page;
   - the inline image `…/images/stock/unsplash/crsfwpuccte-96c21a47.webp` is not in the media index;
   - the editor-note portrait `/giulia_rossi.png` is a site asset, not in the media index.
3. **`5-hidden-gelaterias-you-need-to-try`:** the second sidebar related-post image
   (`images.unsplash.com/photo-1612172166035-4ed0327be526`) is not in the media index.
4. **Banned vocabulary in live text** (optional edits; the eval accepts them as legacy): "tourist
   traps" (gelaterias, subtitle), "The Hidden Gem" (best-time, a section heading), "Hidden Gems"
   (Corniglia, the title), "iconic" (hiking the blue trail; first-timer itinerary),
   "stunning" (train and ferry cheatsheet).

## Reproduce

From the repository root, with the site clone at `cinqueterre.travel/` (outputs outside the
repository; never commit the pack):

```sh
cargo xtask site-pack cinqueterre.travel --articles --out /tmp/real.pack.json
# the per-article, per-check table (Rust, this document's tables)
EVAL_PACK=/tmp/real.pack.json cargo test -p orchestrator --test eval_calibration -- --nocapture
# the eval on the scripted model against the real pack (needs `cargo xtask wasm`)
cd apps/game && EVAL_PACK=/tmp/real.pack.json pnpm exec vitest run src/harness/eval -t "real site pack"
```

Without `EVAL_PACK` both tests do nothing, and CI runs the scripted eval on the committed
`cinqueterre-mini` pack, whose three controls copy the live shapes (one plural banned phrase, two
heroes outside its media index) and pass the calibration row on the legacy profile.
