// @vitest-environment jsdom
// The app shell (ADR-0086): sections along the top open their panel or the town, the lit section
// follows what is open, the sidebar lists every tool with its count, and the body takes the shell.
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { SECTIONS, sectionOf, sectionOffered } from './sections'
import { flush, setup } from './testing'

let ctx: ReturnType<typeof setup> | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

describe('sections', () => {
  it('lights the section of what is open; the Studio by its workbench; nothing open is the town', () => {
    expect(sectionOf(null, 'town')).toBe('town')
    expect(sectionOf('plan', 'town')).toBe('plan')
    expect(sectionOf('inbox', 'town')).toBe('plan')
    expect(sectionOf('hiring', 'town')).toBe('staff')
    expect(sectionOf('finance', 'town')).toBe('town')
    expect(sectionOf('blueprint', 'factory')).toBe('factory')
    expect(sectionOf('blueprint', 'paint')).toBe('building')
  })

  it('offers the Studio sections only with the Studio', () => {
    const building = SECTIONS.find((s) => s.id === 'building')!
    expect(sectionOffered(building, [{ id: 'plan' }])).toBe(false)
    expect(sectionOffered(building, [{ id: 'blueprint' }])).toBe(true)
    expect(sectionOffered(SECTIONS[0], [])).toBe(true)
  })
})

describe('the shell', () => {
  it('opens a section from the top and goes back to the town', async () => {
    ctx = setup()
    await flush()
    const top = screen.getByRole('navigation', { name: 'Sections' })
    const town = within(top).getByRole('button', { name: /^Town/ })
    expect(town.getAttribute('aria-current')).toBe('page')
    // No site models in the fixture: no Studio, so no Building or Factory.
    expect(within(top).queryByRole('button', { name: /^Building/ })).toBeNull()
    fireEvent.click(within(top).getByRole('button', { name: /^Staff/ }))
    await flush()
    expect(screen.getByRole('region', { name: /Org chart/ })).toBeTruthy()
    expect(within(top).getByRole('button', { name: /^Staff/ }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(within(top).getByRole('button', { name: /^Town/ }))
    await flush()
    expect(screen.queryByRole('region', { name: /Org chart/ })).toBeNull()
  })

  it('lists every tool in the sidebar with its count', async () => {
    ctx = setup()
    await flush()
    const tools = screen.getByRole('navigation', { name: 'CEO tools' })
    const org = within(tools).getByRole('button', { name: /^Org chart/ })
    expect(org.querySelector('.tool-num')?.textContent).toBe(String(ctx.store.org.value.staff.length))
    const side = screen.getByRole('complementary', { name: 'Company' })
    expect(within(side).getByRole('region', { name: 'Quick actions' })).toBeTruthy()
  })
})
