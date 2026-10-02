import { describe, expect, it } from 'vitest'
import { NO_SITE_LINKS, type SiteLinks } from './data-source'
import { commitUrl, pageRoute, publishedPageUrl, pullRequestUrl, repoUrl } from './links'

const site = (s: Partial<SiteLinks>): SiteLinks => ({ ...NO_SITE_LINKS, ...s })

describe('links out of the game', () => {
  it('builds pull-request and commit links from the repository the source names', () => {
    const s = site({ repo: 'swarmpress/cinqueterre.travel' })
    expect(repoUrl(s)).toBe('https://github.com/swarmpress/cinqueterre.travel')
    expect(pullRequestUrl(s, 12)).toBe('https://github.com/swarmpress/cinqueterre.travel/pull/12')
    expect(commitUrl(s, '4be81c2d9a01')).toBe('https://github.com/swarmpress/cinqueterre.travel/commit/4be81c2d9a01')
    // A fork for the rehearsal is just another company row.
    expect(pullRequestUrl(site({ repo: 'drietsch/ct-rehearsal' }), 3)).toBe('https://github.com/drietsch/ct-rehearsal/pull/3')
  })

  it('builds nothing from an unknown or malformed repository, pull request or sha', () => {
    expect(pullRequestUrl(NO_SITE_LINKS, 12)).toBeNull()
    expect(commitUrl(NO_SITE_LINKS, '4be81c2d9a01')).toBeNull()
    for (const repo of ['', 'cinqueterre.travel', 'a/b/c', 'https://evil.example/x', 'owner/..', '../x', 'owner/na me', 'owner/x?y']) {
      expect(pullRequestUrl(site({ repo }), 1), repo).toBeNull()
    }
    const s = site({ repo: 'o/r' })
    expect(pullRequestUrl(s, 0)).toBeNull()
    expect(pullRequestUrl(s, 1.5)).toBeNull()
    expect(commitUrl(s, 'not-a-sha')).toBeNull()
  })

  it('maps a repository path to the route the orchestrator gives the page', () => {
    expect(pageRoute('content/pages/blog/harvest-week.json')).toBe('/en/blog/harvest-week/')
    expect(pageRoute('content/pages/blog/harvest-week.json', 'de')).toBe('/de/blog/harvest-week/')
    expect(pageRoute('content/pages/en/via-dell-amore.json')).toBe('/en/via-dell-amore/')
    expect(pageRoute('content/pages/it/index.json')).toBe('/it/')
    expect(pageRoute('content/collections/hikes/vernazza.json')).toBeNull()
    expect(pageRoute('content/pages/blog/../../secret.json')).toBeNull()
  })

  it('links the published page only when the source knows the public address (the hook)', () => {
    const path = 'content/pages/blog/harvest-week.json'
    // What a session provides today: the repository, no public address.
    expect(publishedPageUrl(site({ repo: 'swarmpress/cinqueterre.travel' }), path)).toBeNull()
    expect(publishedPageUrl(site({ publicBaseUrl: 'https://cinqueterre.travel/' }), path)).toBe('https://cinqueterre.travel/en/blog/harvest-week/')
    expect(publishedPageUrl(site({ publicBaseUrl: 'https://owner.github.io/fork', language: 'it' }), path)).toBe('https://owner.github.io/fork/it/blog/harvest-week/')
    expect(publishedPageUrl(site({ publicBaseUrl: 'https://cinqueterre.travel' }), null)).toBeNull()
    expect(publishedPageUrl(site({ publicBaseUrl: 'javascript:alert(1)' }), path)).toBeNull()
    expect(publishedPageUrl(site({ publicBaseUrl: 'not a url' }), path)).toBeNull()
  })
})
