// @vitest-environment jsdom
// Which repository the company writes to (increment G2, ADR-0047): the session
// founds the company with the binding the server's owner configured, passing
// it explicitly, and shows the binding read-only on the boot screen and in
// the HUD.
import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CentralClient, companyFor, type Company, type Me } from '../net/central'
import { mountBootScreen, SESSION_STAGES, showBootBinding } from './boot-screen'
import { hudSite, mountHud, SiteChip } from './hud'
import { siteBindingText, siteBindingView } from './site-binding'

const FORK = 'drietsch/cinqueterre.travel'
const COMPANY: Company = { id: 'co-1', owner_user_id: 'u1', name: 'ceo Dispatch', seed: 7, site_repo: FORK, site_base_branch: 'main', created_at: 1 }
const USER = { id: 'u1', github_id: null, login: 'ceo', name: null, avatar_url: null }

type Call = { method: string; url: string; body: unknown }

function server(routes: (c: Call) => Response) {
  const calls: Call[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const call = { method: init?.method ?? 'GET', url: url.replace('http://central.test', ''), body }
    calls.push(call)
    return routes(call)
  })
  return { client: new CentralClient({ baseUrl: 'http://central.test', fetch }), calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  hudSite.value = null
})

describe('founding the company (the session)', () => {
  it('passes the binding the server is configured with, explicitly', async () => {
    const { client, calls } = server(({ method, url }) => {
      if (url === '/api/companies/me') return json({ error: 'create a company first' }, 404)
      if (method === 'POST' && url === '/api/companies') return json(COMPANY, 201)
      return json({ error: 'unexpected' }, 500)
    })
    const me: Me = { user: USER, company: null, default_binding: { site_repo: FORK, base_branch: 'main' } }
    expect(await companyFor(client, me, 'ceo Dispatch')).toEqual(COMPANY)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/companies/me', 'POST /api/companies'])
    expect(calls[1].body).toEqual({ name: 'ceo Dispatch', site_repo: FORK, base_branch: 'main' })
  })

  it('never takes a write target from the page URL', async () => {
    const { client, calls } = server(({ url }) => (url === '/api/companies/me' ? json({ error: 'none' }, 404) : json(COMPANY, 201)))
    const was = location.href
    history.replaceState(null, '', '/?central=1&site_repo=evil/repo&base_branch=main')
    try {
      await companyFor(client, { user: USER, company: null, default_binding: { site_repo: FORK, base_branch: 'main' } }, 'x')
    } finally {
      history.replaceState(null, '', was)
    }
    expect(JSON.stringify(calls)).not.toContain('evil/repo')
  })

  it('an older server without a default gets the name only, and the server decides', async () => {
    const { client, calls } = server(({ url }) => (url === '/api/companies/me' ? json({ error: 'none' }, 404) : json(COMPANY, 201)))
    await companyFor(client, { user: USER, company: null }, 'ceo Dispatch')
    expect(calls[1].body).toEqual({ name: 'ceo Dispatch' })
  })

  it('an existing company keeps its binding: nothing is created or rebound', async () => {
    const bound = { ...COMPANY, site_repo: 'swarmpress-sites/ceo-site' }
    const { client, calls } = server(() => json(bound))
    const me: Me = { user: USER, company: bound, default_binding: { site_repo: FORK, base_branch: 'main' } }
    expect(await companyFor(client, me, 'x')).toEqual(bound)
    expect(calls).toEqual([])
    // Found by the second lookup (a session that signed in before the company existed).
    const second = server(({ url }) => (url === '/api/companies/me' ? json(bound) : json({ error: 'no' }, 500)))
    expect(await companyFor(second.client, { ...me, company: null }, 'x')).toEqual(bound)
    expect(second.calls.map((c) => c.method)).toEqual(['GET'])
  })
})

describe('the binding on screen', () => {
  it('names the repository and branch, and the server default only when it differs', () => {
    const same = siteBindingView(COMPANY, { site_repo: 'Drietsch/CinqueTerre.travel', base_branch: 'main' })
    expect(same).toEqual({ repo: FORK, baseBranch: 'main', serverDefault: null })
    expect(siteBindingText(same)).toBe(`Writes to ${FORK} (base branch main).`)
    expect(siteBindingView(COMPANY).serverDefault).toBeNull()
    const moved = siteBindingView({ ...COMPANY, site_repo: 'swarmpress-sites/ceo-site' }, { site_repo: FORK, base_branch: 'main' })
    expect(moved.serverDefault).toEqual({ repo: FORK, baseBranch: 'main' })
    expect(siteBindingText(moved)).toContain(`The server's default is ${FORK} (main)`)
    expect(siteBindingView(COMPANY, { site_repo: FORK, base_branch: 'rehearsal' }).serverDefault).toEqual({ repo: FORK, baseBranch: 'rehearsal' })
  })

  it('the boot screen shows it from the moment the company is known, also on a failed boot', () => {
    const boot = mountBootScreen(document.body, SESSION_STAGES)
    const line = () => boot.el.querySelector('.boot-binding') as HTMLElement
    expect(line().hidden).toBe(true)
    boot.stage('login')
    showBootBinding(siteBindingView(COMPANY, { site_repo: FORK, base_branch: 'main' }))
    expect(line().hidden).toBe(false)
    expect(line().textContent).toBe(`Writes to ${FORK} · base main`)
    expect(line().dataset.repo).toBe(FORK)
    expect(line().dataset.mismatch).toBeUndefined()
    expect(line().title).toBe(`Writes to ${FORK} (base branch main).`)
    boot.stage('restore')
    boot.fail(new Error('restore from opfs: replay desync'))
    expect(line().textContent).toContain(FORK)
    // A mismatch with the server's default is spelled out.
    showBootBinding(siteBindingView({ ...COMPANY, site_repo: 'swarmpress-sites/ceo-site' }, { site_repo: FORK, base_branch: 'main' }))
    expect(line().dataset.mismatch).toBe('true')
    expect(line().querySelector('.boot-binding-note')!.textContent).toContain(`Server default: ${FORK} (main)`)
    // Once boot is done the screen is gone, and a late call is harmless.
    boot.done()
    expect(() => showBootBinding(siteBindingView(COMPANY))).not.toThrow()
    expect(document.querySelector('.boot-binding')).toBeNull()
  })

  it('the HUD keeps it on screen, read only, linked to the repository', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const hud = mountHud(el, null)
    hud.set({ clock: '09:00', day: 0, renderer: 'webgl2', version: '0.2.0', fps: 60 })
    expect(el.querySelector('.hud-site')).toBeNull()
    hudSite.value = siteBindingView(COMPANY)
    await new Promise((r) => setTimeout(r, 0))
    const chip = el.querySelector('.hud-site') as HTMLElement
    expect(chip.dataset.repo).toBe(FORK)
    expect(chip.textContent).toBe(`Writes to ${FORK} · main`)
    const link = chip.querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`https://github.com/${FORK}`)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(chip.querySelectorAll('input, button, select, textarea')).toHaveLength(0)
    hud.dispose()
  })

  it('a chip for a binding the server default moved away from is marked; a malformed repo is never a link', () => {
    render(<SiteChip site={siteBindingView({ ...COMPANY, site_repo: 'swarmpress-sites/ceo-site' }, { site_repo: FORK, base_branch: 'main' })} />)
    const chip = document.querySelector('.hud-site') as HTMLElement
    expect(chip.classList.contains('is-warn')).toBe(true)
    expect(chip.title).toContain(`The server's default is ${FORK}`)
    expect(screen.getByText(/the server's default is now/)).toBeTruthy()
    cleanup()
    render(<SiteChip site={{ repo: 'not a repo', baseBranch: 'main', serverDefault: null }} />)
    expect(document.querySelector('.hud-site a')).toBeNull()
    expect(document.querySelector('.hud-site')!.textContent).toContain('not a repo · main')
  })
})
