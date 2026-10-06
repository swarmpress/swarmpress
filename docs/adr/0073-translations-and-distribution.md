# ADR-0073 — Translations and distribution

**Status:** Accepted (builds on ADR-0070's article updates and ADR-0069's board; amends ADR-0061's negative on English under other languages)
**Date:** 2026-10-06

## Context

cinqueterre.travel serves four languages, but 17 of its 19 articles exist in English only; they are
served under `/de`, `/fr` and `/it` with English text (a negative ADR-0061 accepted). The content
model is JSON blocks with `LocalizedString` (`en` required, rule 12), so a translation is filling
the other languages of an existing page's fields: an update (ADR-0070), not a new page. The
company has a translator role and SEO, marketing and social media roles, and none of them works.
The owner ordered translations and distribution after the analytics loop (2026-10-06).

## Decision

1. **The audit lists untranslated articles.** For each article, the site languages its title has
   no text for (`untranslated` in `GET /api/site/audit`).
2. **`WorkItemKind::Translation`**, one language per item: its brief names the page and the
   language (text-side; the sim knows only the kind). The board plans translations from the
   audit's list like site care (a `translation` proposal of an alias, with its `language`). When
   it starts, the sim prefers a free translator, then any drafter.
3. **A translation is an update.** The Draft job reads the live page, translates every field
   that is already a `LocalizedString` (an object of languages with `en`: the title, the SEO
   fields, localized blocks such as editorial heroes and intros; never slugs, paths or ids) in
   batches, writes the language's text next to the English, and commits an update that names the
   blob it read (ADR-0070). **Plain-string fields are not converted:** the frozen theme renders a
   paragraph's or heading's text as it is (`ContentRenderer.astro`), so an object there would show
   as `[object Object]`; until the cutover's theme reads localized block text (rule 9), an
   article's body stays English and its translation covers its title, SEO and localized blocks. Place and proper names stay as they are; the site's style guide applies. The
   review is an update review of a sample of the translated fields.
4. **Distribution is promotion copy, not sending.** When an article or a refresh goes live
   (`DeployLanded`) and the `distribution` policy is on, the sim requests `JobKind::Promotion`
   for the social media manager (else the marketing manager), once by construction (a deploy lands
   once). The job writes a newsletter blurb and posts for the site's channels with the article's
   URL, as a `distribution` post in the item's thread for the CEO to use. Nothing is sent or posted
   by the game: that needs an integration and the CEO's consent, a later decision.
5. **World format 5** for `Policies.distribution`; old companies rebase once (ADR-0069 decision 8).

## Consequences

- The site's other languages get real text, article by article, planned with everything else.
- A translation costs about one model call per 30 fields; promotion copy one short call.
- **Negative:**
  - Until the theme localizes block text, translating a blog article gives its title, SEO and
    localized blocks in the language and leaves its body in English: the visible gain is in
    titles, search snippets and the village pages, whose blocks are localized already.
  - A machine translation can be wrong in ways an editor reading English does not see; the
    review samples, and the CEO's gate stays. A native reviewer per language is not modelled.
  - A translated field and its English drift apart when a later refresh changes the English: a
    refresh keeps only English for what it changed (ADR-0070), so the translation of that field
    is dropped and the audit lists the language again.
  - Promotion copy the CEO never uses is wasted work.
- **Alternatives rejected:**
  - *Separate pages per language.* The content model localizes fields in one page; the theme
    routes languages from it.
  - *Posting to social networks from the game.* Outward-facing, irreversible, and needs
    credentials the browser must not hold (ADR-0054); not without a decision of its own.
