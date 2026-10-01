/**
 * SimPress first-party analytics beacon (ADR-0032).
 *
 * - No cookies, no storage, no ids: the server counts visitors with a salted
 *   hash that rotates daily.
 * - Silent when Do-Not-Track or Global Privacy Control is on, or when the page
 *   URL carries `?notrack`.
 * - Events: `pageview` (load + SPA history changes), `engagement` (visible
 *   time on visibilitychange/pagehide), `scroll` (25/50/75/100), `outbound`.
 * - Payload keys are short to keep the script tiny; see the server's
 *   `tracker::RawEvent` for the mapping.
 */

export interface Payload {
  k: string;
  t: 'pageview' | 'engagement' | 'scroll' | 'outbound';
  p: string;
  l?: string;
  r?: string;
  v?: string;
  e?: number;
  s?: number;
  o?: string;
  us?: string;
  um?: string;
  uc?: string;
}

/** True when the visitor opted out (DNT, GPC or `?notrack`). */
export function optedOut(w: Window): boolean {
  const n = w.navigator as Navigator & { globalPrivacyControl?: boolean };
  const dnt = n.doNotTrack ?? (w as unknown as { doNotTrack?: string }).doNotTrack;
  return dnt === '1' || dnt === 'yes' || n.globalPrivacyControl === true || /[?&]notrack(=|&|$)/.test(w.location.search);
}

/**
 * Start tracking for the page `script` was loaded on. Returns `false` when it
 * stays silent (no key, or the visitor opted out).
 */
export function init(script: HTMLScriptElement | null, w: Window = window): boolean {
  if (!script) return false;
  const key = script.getAttribute('data-project');
  if (!key || optedOut(w)) return false;
  const d = w.document;
  const n = w.navigator;
  const l = w.location;
  const endpoint = script.getAttribute('data-endpoint') || new URL(script.src, l.href).origin + '/t/e';

  let path = l.pathname;
  let milestones: number[] = [];
  let visibleSince = d.visibilityState === 'visible' ? Date.now() : 0;
  let engaged = 0;

  const send = (t: Payload['t'], extra?: Partial<Payload>): void => {
    const width = w.innerWidth;
    const body = JSON.stringify({
      k: key,
      t,
      p: path,
      l: d.documentElement.lang || undefined,
      v: width < 640 ? 's' : width < 1024 ? 'm' : 'l',
      ...extra,
    });
    try {
      if (n.sendBeacon && n.sendBeacon(endpoint, body)) return;
    } catch {
      /* fall through to fetch */
    }
    try {
      void w
        .fetch(endpoint, {
          method: 'POST',
          body,
          keepalive: true,
          mode: 'no-cors',
          credentials: 'omit',
          headers: { 'content-type': 'text/plain' },
        })
        .catch(() => undefined);
    } catch {
      /* never break the page */
    }
  };

  const flush = (): void => {
    if (visibleSince) {
      engaged += Date.now() - visibleSince;
      visibleSince = 0;
    }
    if (engaged > 0) send('engagement', { e: engaged });
    engaged = 0;
  };

  const pageview = (first: boolean): void => {
    milestones = [];
    const extra: Partial<Payload> = {};
    if (first) {
      const q = new URLSearchParams(l.search);
      extra.us = q.get('utm_source') || undefined;
      extra.um = q.get('utm_medium') || undefined;
      extra.uc = q.get('utm_campaign') || undefined;
      try {
        const ref = d.referrer && new URL(d.referrer).hostname;
        if (ref && ref !== l.hostname) extra.r = ref;
      } catch {
        /* ignore bad referrers */
      }
    }
    send('pageview', extra);
    scroll();
  };

  const scroll = (): void => {
    const h = d.documentElement.scrollHeight;
    const pct = h > 0 ? ((w.scrollY + w.innerHeight) * 100) / h : 100;
    for (const m of [25, 50, 75, 100]) {
      if (pct >= m && milestones.indexOf(m) < 0) {
        milestones.push(m);
        send('scroll', { s: m });
      }
    }
  };

  const navigated = (): void => {
    if (l.pathname === path) return;
    flush();
    if (d.visibilityState === 'visible') visibleSince = Date.now();
    path = l.pathname;
    pageview(false);
  };

  for (const fn of ['pushState', 'replaceState'] as const) {
    const orig = w.history[fn];
    w.history[fn] = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = orig.apply(this, args);
      navigated();
      return r;
    };
  }
  w.addEventListener('popstate', navigated);
  w.addEventListener('scroll', scroll, { passive: true });
  d.addEventListener('visibilitychange', () => {
    if (d.visibilityState === 'hidden') flush();
    else visibleSince = Date.now();
  });
  w.addEventListener('pagehide', flush);
  d.addEventListener(
    'click',
    (ev) => {
      const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (a && /^https?:$/.test(a.protocol) && a.hostname !== l.hostname) send('outbound', { o: a.hostname });
    },
    true,
  );

  pageview(true);
  return true;
}
