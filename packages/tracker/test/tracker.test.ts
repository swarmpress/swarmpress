import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init, optedOut } from '../src/tracker';

type Sent = { url: string; body: Record<string, unknown> };

let sent: Sent[];
// Trackers from earlier tests stay attached to the shared jsdom window, so
// every test uses its own key and only records its own beacons.
let key = '';
let n = 0;

function script(attrs: Record<string, string> = { 'data-project': key }): HTMLScriptElement {
  const s = document.createElement('script');
  s.src = 'https://play.swarmpress.example/t/s.js';
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  return s;
}

function setNav(props: Record<string, unknown>) {
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(navigator, k, { value: v, configurable: true, writable: true });
  }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

const types = () => sent.map((s) => s.body.t);

beforeEach(() => {
  sent = [];
  key = `pk_test${++n}`;
  history.replaceState(null, '', '/en/blog/harvest?utm_source=Newsletter&utm_medium=email');
  document.documentElement.lang = 'en';
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 4000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true, writable: true });
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  setNav({
    doNotTrack: null,
    globalPrivacyControl: undefined,
    sendBeacon: vi.fn((url: string, body: string) => {
      const parsed = JSON.parse(body);
      if (parsed.k === key) sent.push({ url, body: parsed });
      return true;
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tracker', () => {
  it('sends a pageview on load with utm, lang and viewport, to the script origin', () => {
    expect(init(script())).toBe(true);
    expect(sent[0].url).toBe('https://play.swarmpress.example/t/e');
    expect(sent[0].body).toMatchObject({
      k: key,
      t: 'pageview',
      p: '/en/blog/harvest',
      l: 'en',
      us: 'Newsletter',
      um: 'email',
    });
    expect(['s', 'm', 'l']).toContain(sent[0].body.v);
    // No query string, cookies or storage.
    expect(JSON.stringify(sent[0].body)).not.toContain('?');
    expect(document.cookie).toBe('');
    expect(localStorage.length).toBe(0);
  });

  it('honours data-endpoint', () => {
    init(script({ 'data-project': key, 'data-endpoint': 'https://collector.example/t/e' }));
    expect(sent[0].url).toBe('https://collector.example/t/e');
  });

  it('stays silent without a project key', () => {
    expect(init(script({}))).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('honours Do-Not-Track', () => {
    setNav({ doNotTrack: '1' });
    expect(optedOut(window)).toBe(true);
    expect(init(script())).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('honours Global Privacy Control', () => {
    setNav({ globalPrivacyControl: true });
    expect(init(script())).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('honours ?notrack', () => {
    history.replaceState(null, '', '/en/?notrack');
    expect(init(script())).toBe(false);
    history.replaceState(null, '', '/en/?a=1&notrack=1');
    expect(init(script())).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('tracks SPA navigations and flushes engagement for the previous page', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    init(script());
    vi.setSystemTime(1_004_000);
    history.pushState(null, '', '/en/villages/manarola');
    const t = types();
    expect(t).toContain('engagement');
    const eng = sent.find((s) => s.body.t === 'engagement')!;
    expect(eng.body.p).toBe('/en/blog/harvest');
    expect(eng.body.e).toBe(4000);
    const pv = sent.filter((s) => s.body.t === 'pageview');
    expect(pv).toHaveLength(2);
    expect(pv[1].body.p).toBe('/en/villages/manarola');
    expect(pv[1].body.us).toBeUndefined();
    // Same path again: no new pageview.
    history.replaceState({ x: 1 }, '', '/en/villages/manarola');
    expect(sent.filter((s) => s.body.t === 'pageview')).toHaveLength(2);
  });

  it('sends visible time on visibilitychange and pagehide only once', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    init(script());
    vi.setSystemTime(2_007_500);
    setVisibility('hidden');
    window.dispatchEvent(new Event('pagehide'));
    const eng = sent.filter((s) => s.body.t === 'engagement');
    expect(eng).toHaveLength(1);
    expect(eng[0].body.e).toBe(7500);
    setVisibility('visible');
    vi.setSystemTime(2_009_500);
    window.dispatchEvent(new Event('pagehide'));
    expect(sent.filter((s) => s.body.t === 'engagement').map((s) => s.body.e)).toEqual([7500, 2000]);
  });

  it('sends scroll milestones once each', () => {
    init(script());
    // 800 of 4000 px visible = 20%: no milestone yet.
    expect(sent.filter((s) => s.body.t === 'scroll')).toHaveLength(0);
    (window as unknown as { scrollY: number }).scrollY = 1400; // (1400+800)/4000 = 55%
    window.dispatchEvent(new Event('scroll'));
    expect(sent.filter((s) => s.body.t === 'scroll').map((s) => s.body.s)).toEqual([25, 50]);
    (window as unknown as { scrollY: number }).scrollY = 3200; // 100%
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    expect(sent.filter((s) => s.body.t === 'scroll').map((s) => s.body.s)).toEqual([25, 50, 75, 100]);
  });

  it('reports outbound link clicks but not internal ones', () => {
    init(script());
    const out = document.createElement('a');
    out.href = 'https://www.trenitalia.com/timetable';
    out.innerHTML = '<span>trains</span>';
    const inside = document.createElement('a');
    inside.href = '/en/villages/vernazza';
    document.body.append(out, inside);
    out.addEventListener('click', (e) => e.preventDefault());
    inside.addEventListener('click', (e) => e.preventDefault());
    (out.firstChild as HTMLElement).click();
    inside.click();
    const o = sent.filter((s) => s.body.t === 'outbound');
    expect(o).toHaveLength(1);
    expect(o[0].body.o).toBe('www.trenitalia.com');
  });

  it('falls back to fetch keepalive when sendBeacon is unavailable', () => {
    setNav({ sendBeacon: undefined });
    const fetch = vi.fn(() => Promise.resolve(new Response(null)));
    vi.stubGlobal('fetch', fetch);
    init(script());
    expect(fetch).toHaveBeenCalled();
    const [, opts] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(opts.keepalive).toBe(true);
    expect(opts.credentials).toBe('omit');
    const own = fetch.mock.calls
      .map((c) => JSON.parse(((c as unknown as [string, RequestInit])[1].body as string)))
      .filter((b) => b.k === key);
    expect(own[0].t).toBe('pageview');
    vi.unstubAllGlobals();
  });
});
