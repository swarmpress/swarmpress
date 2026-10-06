import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { initials, type Persona } from '../personas'
import { textOn } from '../format'
import { useStore, type PanelId } from '../store'

const ICONS: Record<string, string> = {
  plan: 'M4 5h16v2H4zM4 11h10v2H4zM4 17h13v2H4zM18 10l3 2-3 2z',
  inbox: 'M3 5h18v14H3zM3 13h5l2 3h4l2-3h5',
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  org: 'M10 3h4v4h-4zM4 15h4v4H4zM10 15h4v4h-4zM16 15h4v4h-4zM12 7v4M6 15v-4h12v4',
  projects: 'M3 6h7l2 2h9v11H3z',
  finance: 'M4 19V9M10 19V5M16 19v-7M21 19H3',
  performance: 'M3 17l5-6 4 3 6-8 3 3',
  hiring: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M18 8v6M15 11h6',
  blueprint: 'M4 21V8l8-5 8 5v13zM4 12h16M4 16.5h16M10 21v-3h4v3',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      class="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name] ?? ''} />
    </svg>
  )
}

export function Avatar({ persona, size = 32 }: { persona: Persona; size?: number }) {
  const bg = persona.appearance.palette
  return (
    <span
      class="avatar"
      style={{ background: bg, color: textOn(bg), width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` }}
      aria-hidden="true"
    >
      {initials(persona.name)}
    </span>
  )
}

/** A person anywhere in the UI: avatar + name, opens the profile card. */
export function PersonButton({ staff, detail, compact }: { staff: string; detail?: ComponentChildren; compact?: boolean }) {
  const store = useStore()
  const p = store.personaOf(staff)
  return (
    <button
      type="button"
      class={`person${compact ? ' is-compact' : ''}`}
      onClick={(e) => store.openProfile({ staff }, e.currentTarget)}
      aria-label={compact ? `${p.name}, open profile` : undefined}
      title={compact ? p.name : undefined}
    >
      <Avatar persona={p} size={compact ? 24 : 30} />
      {!compact && (
        <span class="person-text">
          <span class="person-name">{p.name}</span>
          {detail && <span class="person-detail">{detail}</span>}
        </span>
      )}
    </button>
  )
}

export function Meter({ label, value, max = 1, tone, text }: { label: string; value: number; max?: number; tone?: 'good' | 'warn' | 'bad' | 'info'; text?: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div class="meter-row">
      <span class="meter-label">{label}</span>
      <div
        class={`meter meter-${tone ?? 'info'}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuetext={text}
      >
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      {text && <span class="meter-text">{text}</span>}
    </div>
  )
}

/** A docked panel: labelled region with a close button. */
export function Panel({ id, title, wide, actions, children }: { id: PanelId; title: string; wide?: boolean; actions?: ComponentChildren; children: ComponentChildren }) {
  const store = useStore()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [id])
  return (
    <section ref={ref} id={`panel-${id}`} class={`panel${wide ? ' is-wide' : ''}`} aria-labelledby={`panel-${id}-title`} tabIndex={-1}>
      <header class="panel-head">
        <h2 id={`panel-${id}-title`}>{title}</h2>
        <div class="panel-actions">
          {actions}
          <button type="button" class="icon-btn" onClick={() => (store.panel.value = null)} aria-label={`Close ${title}`}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div class="panel-body">{children}</div>
    </section>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'high' | 'medium' | 'low' | 'good' | 'warn' | 'bad' | 'info'; children: ComponentChildren }) {
  return <span class={`badge badge-${tone}`}>{children}</span>
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad'; title: string; children?: ComponentChildren }) {
  return (
    <div class={`notice notice-${tone}`} role={tone === 'bad' ? 'alert' : 'note'}>
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  )
}

/** Accessible tabs (roving focus with arrow keys). */
export function Tabs<T extends string>({ label, tabs, value, onChange, idPrefix }: { label: string; tabs: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; idPrefix: string }) {
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next >= 0) {
      e.preventDefault()
      e.stopPropagation()
      onChange(tabs[next].id)
      queueMicrotask(() => document.getElementById(`${idPrefix}-tab-${tabs[next].id}`)?.focus())
    }
  }
  return (
    <div class="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={t.id === value}
          aria-controls={`${idPrefix}-tabpanel`}
          tabIndex={t.id === value ? 0 : -1}
          class="tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function TabPanel({ idPrefix, value, children }: { idPrefix: string; value: string; children: ComponentChildren }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-tabpanel`} aria-labelledby={`${idPrefix}-tab-${value}`} class="tabpanel">
      {children}
    </div>
  )
}

/** Tab focus stays inside an open modal dialog (the profile card, the article preview). */
export function trapTab(e: KeyboardEvent, root: HTMLElement | null) {
  if (e.key !== 'Tab' || !root) return
  const f = Array.from(
    root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, a[href], [tabindex="0"]'),
  )
  if (f.length === 0) return
  const first = f[0]
  const last = f[f.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

/** A link that opens outside the game, or its text when the address is not known. */
export function External({ href, children }: { href: string | null; children: ComponentChildren }) {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <>{children}</>
  )
}

export const priorityTone =(p: string) => (p === 'high' || p === 'urgent' ? 'high' : p === 'medium' || p === 'normal' ? 'medium' : 'low')
