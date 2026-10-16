/* swarm.press design enhancements (ADR-0093 addendum 2026-10-14, "one audited first-party script").
 * A site works without this file: it only adds behaviour a design specifies and CSS cannot give.
 * It is part of swarm.press (not written by a model, never changed per site), served same-origin as
 * /ds.js, and reads nothing but the page and /search-index.json. No eval, no inline handlers, no
 * third-party requests, no storage beyond sessionStorage flags. Every behaviour honours
 * prefers-reduced-motion. Hooks are classes the theme's component vocabulary already uses. */
(function () {
  'use strict';
  var d = document, w = window, root = d.documentElement;
  var reduced = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.add('ds-js');
  function $$(sel, el) { return Array.prototype.slice.call((el || d).querySelectorAll(sel)); }
  function on(el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt || false); }
  /* The theme's words in the page's language: its stylesheet sets --ds-l-css-js-{key} per
   * :lang(); the English is the default. */
  function L(key, en) {
    var v = w.getComputedStyle ? w.getComputedStyle(root).getPropertyValue('--ds-l-css-js-' + key).trim() : '';
    return v ? v.replace(/^["\u201C]|["\u201D]$/g, '') : en;
  }

  /* 05 Masthead tide: past 80px the masthead takes its ground and shadow; scrolling down hides it,
   * any scroll up reveals it. Reduced motion: always visible. */
  var mast = d.querySelector('.ds-masthead');
  if (mast) {
    var last = w.scrollY, ticking = false;
    var tide = function () {
      var y = w.scrollY;
      mast.classList.toggle('ds-scrolled', y > 80);
      if (!reduced) mast.classList.toggle('ds-hidden', y > 80 && y > last && !mast.contains(d.activeElement));
      last = y; ticking = false;
    };
    on(w, 'scroll', function () { if (!ticking) { ticking = true; w.requestAnimationFrame(tide); } }, { passive: true });
    tide();
  }

  /* 4.20 Mobile menu: in the open sheet a place's row opens its pages in place. */
  $$('.ds-nav-dots .wp-block-navigation-item.has-child').forEach(function (li) {
    var btn = li.querySelector(':scope > .wp-block-navigation-submenu__toggle');
    on(btn, 'click', function () {
      if (!li.closest('.is-menu-open')) return;
      var open = li.classList.toggle('ds-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  /* 4.6 Essentials count-up (09): numbers count from 0 when first seen. Reduced motion: final values. */
  var counters = $$('.ds-count');
  if (counters.length && !reduced && 'IntersectionObserver' in w) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var el = e.target, text = el.textContent, m = text.match(/-?\d+/g), pad = text.indexOf(':') >= 0;
        if (!m) return;
        var start = null;
        var step = function (t) {
          if (start === null) start = t;
          var k = Math.min(1, (t - start) / 600), ease = 1 - Math.pow(1 - k, 3), i = 0;
          el.textContent = text.replace(/-?\d+/g, function (n) {
            var v = '' + Math.round(parseInt(m[i++], 10) * ease);
            while (pad && v.length < n.length) v = '0' + v;
            return v;
          });
          if (k < 1) w.requestAnimationFrame(step); else el.textContent = text;
        };
        w.requestAnimationFrame(step);
      });
    });
    counters.forEach(function (c) { io.observe(c); });
  }

  /* 4.10 Contents rail: the entry of the section being read is marked. 10 Reading progress where CSS
   * scroll timelines are missing. */
  var rail = $$('.ds-contents a[href^="#"], .ct-contents a[href^="#"]');
  if (rail.length && 'IntersectionObserver' in w) {
    var byId = {};
    rail.forEach(function (a) { var t = d.getElementById(decodeURIComponent(a.hash.slice(1))); if (t) byId[t.id] = a; });
    var seen = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        rail.forEach(function (a) { a.classList.remove('is-active'); a.removeAttribute('aria-current'); });
        var a = byId[e.target.id];
        if (a) { a.classList.add('is-active'); a.setAttribute('aria-current', 'location'); }
      });
    }, { rootMargin: '0px 0px -70% 0px' });
    Object.keys(byId).forEach(function (id) { seen.observe(d.getElementById(id)); });
  }
  var bar = d.querySelector('.ds-progress');
  if (bar && !(w.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'))) {
    var progress = function () {
      var h = root.scrollHeight - root.clientHeight;
      bar.style.setProperty('--ds-progress', h > 0 ? String(w.scrollY / h) : '0');
    };
    on(w, 'scroll', progress, { passive: true });
    progress();
  }

  /* 08 Image wipe-in: pictures reveal from the top once per session. Reduced motion: static. */
  var wipes = $$('.ds-wipe img');
  var wiped = false;
  try { wiped = w.sessionStorage.getItem('ds-wiped') === '1'; w.sessionStorage.setItem('ds-wiped', '1'); } catch (e) { wiped = true; }
  if (wipes.length && !reduced && !wiped && 'IntersectionObserver' in w) {
    var wio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.intersectionRatio >= 0.2) { e.target.classList.add('ds-in'); wio.unobserve(e.target); } });
    }, { threshold: [0.2] });
    wipes.forEach(function (img) { img.classList.add('ds-wipe-ready'); wio.observe(img); });
  }

  /* 7.1 Listing bar, fix 07 and 11 Filter indicator: the entries' own labels as toggle chips; the
   * list cross-fades (200ms) to the chosen label. Reduced motion: jump and fade. */
  $$('.ds-bar').forEach(function (barEl) {
    var list = barEl.parentElement && barEl.parentElement.querySelector('.wp-block-post-template');
    if (!list) {
      var next = barEl.nextElementSibling;
      while (next && !list) { list = next.querySelector && next.querySelector('.wp-block-post-template'); next = next.nextElementSibling; }
    }
    if (!list) return;
    var items = $$(':scope > li', list);
    var labelOf = function (li) { var c = li.querySelector('.ds-chip, .ds-eyebrow'); return c ? c.textContent.trim() : ''; };
    var labels = [];
    items.forEach(function (li) { var l = labelOf(li); if (l && labels.indexOf(l) < 0) labels.push(l); });
    if (labels.length < 2) return;
    var group = d.createElement('div');
    group.className = 'ds-filter';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', L('filter', 'Filter'));
    var all = barEl.getAttribute('data-all') || L('all', 'All');
    [all].concat(labels).forEach(function (l, i) {
      var b = d.createElement('button');
      b.type = 'button'; b.className = 'ds-filter-chip'; b.textContent = l;
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      on(b, 'click', function () {
        $$('.ds-filter-chip', group).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        list.classList.add('ds-fading');
        w.setTimeout(function () {
          items.forEach(function (li) { li.hidden = i !== 0 && labelOf(li) !== l; });
          list.classList.remove('ds-fading');
        }, reduced ? 0 : 200);
      });
      group.appendChild(b);
    });
    barEl.appendChild(group);
  });

  /* Notte at night: templates marked ds-notte-at-night take the dark scheme from 20:00 to 06:00. */
  if (d.querySelector('.ds-notte-at-night')) {
    var hour = new Date().getHours();
    if (hour >= 20 || hour < 6) root.classList.add('ds-night');
  }

  /* 4.11 Search overlay: opens from the masthead's search or with "/" while not typing; results from
   * /search-index.json grouped, the match marked; arrow keys move, Enter opens, Esc closes. */
  var openers = $$('.ds-search, form.wp-block-search');
  if (!openers.length) return;
  var dlg = null, input, results, index = null, timer = null, active = -1, lastFocus = null;
  var labels = { villages: L('villages', 'Villages'), stories: L('stories', 'Stories'), stays: L('stays', 'Stays'), pages: L('pages', 'Pages') };
  function load(cb) {
    if (index) return cb();
    var x = new XMLHttpRequest();
    x.open('GET', '/search-index.json');
    x.onload = function () { try { index = JSON.parse(x.responseText); } catch (e) { index = []; } cb(); };
    x.onerror = function () { index = []; cb(); };
    x.send();
  }
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mark(s, q) {
    var i = s.toLowerCase().indexOf(q);
    return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length));
  }
  function lang() { var m = location.pathname.match(/^\/([a-z]{2})\//); return m ? m[1] : (root.lang || 'en').slice(0, 2); }
  /* The index is the export's /search-index.json: [{url, title, text}]; a page's language is its
   * first path segment, its group what its path says (a story, a stay, a place's page). */
  function groupOf(url) {
    var segs = url.split('/').filter(Boolean);
    if (/\/blog\//.test(url)) return 'stories';
    if (/(hotel|accommodation|apartment|agriturism|camping|stay)/.test(url)) return 'stays';
    if (segs.length === 2) return 'villages';
    return 'pages';
  }
  function render() {
    var q = input.value.trim().toLowerCase();
    active = -1;
    if (q.length < 2) { results.innerHTML = ''; return; }
    var l = lang(), groups = {}, list = Array.isArray(index) ? index : (index.entries || []);
    list.forEach(function (e) {
      var m = e.url.match(/^\/([a-z]{2})\//);
      if (m && m[1] !== l) return;
      var title = (e.title || '').split(' | ')[0];
      if ((title + ' ' + (e.text || '')).toLowerCase().indexOf(q) < 0) return;
      var g = groupOf(e.url);
      (groups[g] = groups[g] || []).push({ url: e.url, title: title });
    });
    var html = '', any = false;
    ['villages', 'stories', 'stays', 'pages'].forEach(function (g) {
      var found = (groups[g] || []).slice(0, 6);
      if (!found.length) return;
      any = true;
      html += '<div><p class="ds-search-group">' + (labels[g] || g) + ' · ' + (groups[g] || []).length + '</p><ul>';
      found.forEach(function (e) { html += '<li><a href="' + esc(e.url) + '">' + mark(e.title, q) + '</a></li>'; });
      html += '</ul></div>';
    });
    results.innerHTML = any ? html : '<p class="ds-search-empty">' + esc(L('nothing-found', 'Nothing found. Try a village or a place.')) + '</p>';
  }
  function move(k) {
    var links = $$('a', results);
    if (!links.length) return;
    active = (active + k + links.length) % links.length;
    links.forEach(function (a, i) { a.classList.toggle('is-active', i === active); });
    links[active].scrollIntoView({ block: 'nearest' });
  }
  function close() {
    if (!dlg) return;
    dlg.hidden = true;
    root.classList.remove('ds-search-open');
    if (lastFocus) lastFocus.focus();
  }
  function open() {
    lastFocus = d.activeElement;
    if (!dlg) {
      dlg = d.createElement('div');
      dlg.className = 'ds-search-overlay';
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      dlg.setAttribute('aria-label', L('search', 'Search'));
      dlg.innerHTML = '<div class="ds-search-panel"><label class="ds-search-label" for="ds-search-q">' + esc(L('search', 'Search')) + '</label>' +
        '<input id="ds-search-q" type="search" autocomplete="off" spellcheck="false"><button type="button" class="ds-search-close" aria-label="' + esc(L('close', 'Close')) + '">×</button>' +
        '<div class="ds-search-results" aria-live="polite"></div></div>';
      d.body.appendChild(dlg);
      input = dlg.querySelector('input');
      results = dlg.querySelector('.ds-search-results');
      on(dlg.querySelector('.ds-search-close'), 'click', close);
      on(dlg, 'click', function (e) { if (e.target === dlg) close(); });
      on(input, 'input', function () { w.clearTimeout(timer); timer = w.setTimeout(function () { load(render); }, 120); });
      on(dlg, 'keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); $$('a', results)[active].click(); }
        else if (e.key === 'Tab') {
          var f = $$('input, button, a', dlg);
          if (!f.length) return;
          if (e.shiftKey && d.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && d.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
      });
    }
    dlg.hidden = false;
    root.classList.add('ds-search-open');
    input.focus();
    load(function () {});
  }
  openers.forEach(function (o) {
    var form = o.tagName === 'FORM' ? o : o.querySelector('form');
    on(form, 'submit', function (e) { e.preventDefault(); open(); });
    on(o.querySelector('input, button'), 'focus', function (e) { if (e.target.tagName === 'INPUT') { e.target.blur(); open(); } });
    on(o.querySelector('button'), 'click', function (e) { e.preventDefault(); open(); });
  });
  on(d, 'keydown', function (e) {
    var t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); open(); }
  });
})();
