(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Remember the visitor's language choice (used by boot.js on the home page)
  $$('a.lang').forEach(a => a.addEventListener('click', () => { try { localStorage.setItem('dcl', a.getAttribute('hreflang')); } catch (e) {} }));

  // Mobile menu
  const m = $('.menu'), nav = $('#nav');
  if (m) {
    const set = o => { nav.classList.toggle('open', o); m.setAttribute('aria-expanded', o); };
    m.addEventListener('click', () => set(!nav.classList.contains('open')));
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { set(false); m.focus(); } });
    nav.addEventListener('click', ev => { if (ev.target.closest('a')) set(false); });
  }

  // Broken images fall back to the placeholder underneath
  $$('.media img').forEach(i => {
    const bad = () => i.classList.add('broken');
    i.addEventListener('error', bad);
    if (i.complete && i.naturalWidth === 0) bad();
  });

  // Portfolio filter + search
  const grid = $('#grid');
  if (grid) {
    const q = $('#q'), chips = $$('.chip'), empty = $('#empty');
    let cat = '';
    const run = () => {
      const t = q.value.trim().toLowerCase();
      let n = 0;
      $$('.card', grid).forEach(c => {
        const ok = (!cat || c.dataset.cat === cat) && (!t || c.dataset.text.includes(t));
        c.hidden = !ok; if (ok) n++;
      });
      empty.hidden = n > 0;
    };
    chips.forEach(c => c.addEventListener('click', () => {
      cat = c.dataset.f; chips.forEach(x => x.classList.toggle('on', x === c)); run();
    }));
    q.addEventListener('input', run);
  }

  // Contact form
  const f = $('#inquiry');
  if (f && !f.hasAttribute('data-off')) {
    const st = $('#status'), b = $('button[type=submit]', f);
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (f.elements._gotcha.value) return;
      const msg = k => f.getAttribute('data-m-' + k) || '';
      if (!f.checkValidity()) { f.reportValidity(); st.className = 'err'; st.textContent = msg('required'); return; }
      b.disabled = true; st.className = ''; st.textContent = msg('sending');
      try {
        const r = await fetch(f.action, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams(new FormData(f)) });
        if (!r.ok) throw new Error(r.status);
        f.reset(); st.className = 'ok'; st.textContent = st.dataset.success || '';
      } catch {
        st.className = 'err'; st.textContent = msg('error');
      }
      b.disabled = false;
    });
  }
  // Services tabs (all panels stay visible without JS)
  const tabs = $$('.tab');
  if (tabs.length) {
    const show = i => tabs.forEach((t, k) => {
      t.classList.toggle('on', k === i); t.setAttribute('aria-selected', k === i);
      $('#' + t.getAttribute('aria-controls')).hidden = k !== i;
    });
    tabs.forEach((t, i) => t.addEventListener('click', () => show(i)));
    show(0);
  }
  // Motion (skipped entirely for reduced-motion users)
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const sel = '.sec-head,.two,.card,.svc,.feats>div,.steps li,.panel,.tabs,.cols3>section,.banner,.quotes figure,.sec>h2,.case>section,.contact>*';
    $$(sel).forEach(el => {
      el.setAttribute('data-r', '');
      el.style.setProperty('--d', ([...el.parentNode.children].indexOf(el) % 6) * 0.08 + 's');
    });
    const io = new IntersectionObserver(es => es.forEach(x => {
      if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); }
    }), { threshold: 0.12 });
    $$('[data-r]').forEach(el => io.observe(el));

    // Scroll-linked word reveal
    const rw = $('.reveal-words');
    if (rw) {
      rw.classList.add('rw');
      const w = $$('span', rw); let tick = false;
      const upd = () => {
        tick = false;
        const r = rw.getBoundingClientRect(), vh = innerHeight;
        const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (vh * 0.55 + r.height)));
        w.forEach((s, i) => s.classList.toggle('on', i < Math.ceil(p * w.length)));
      };
      addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true });
      upd();
    }

    // Hero parallax
    const v = $('.visual');
    if (v) addEventListener('pointermove', ev => {
      v.style.setProperty('--mx', ev.clientX / innerWidth - 0.5);
      v.style.setProperty('--my', ev.clientY / innerHeight - 0.5);
    }, { passive: true });

    // Hero headline: words rise one by one
    const h1 = $('.hero h1');
    if (h1) {
      const frag = document.createDocumentFragment(); let i = 0;
      const add = node => {
        const w = document.createElement('span'), inner = document.createElement('span');
        w.className = 'w'; w.style.setProperty('--i', i++); inner.appendChild(node); w.appendChild(inner);
        frag.appendChild(w); frag.appendChild(document.createTextNode(' '));
      };
      [...h1.childNodes].forEach(n => {
        if (n.nodeType === 3) n.textContent.split(/\s+/).filter(Boolean).forEach(t => add(document.createTextNode(t)));
        else add(n);
      });
      h1.textContent = ''; h1.appendChild(frag); h1.classList.add('split');
    }

    // Process line draws with scroll
    const st = $('.steps');
    if (st) {
      const lis = $$('li', st); let tk = false;
      const up = () => {
        tk = false;
        const r = st.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (innerHeight * 0.8 - r.top) / (innerHeight * 0.35)));
        st.style.setProperty('--p', p);
        lis.forEach((li, k) => li.classList.toggle('lit', p >= k / lis.length + 0.04));
      };
      addEventListener('scroll', () => { if (!tk) { tk = true; requestAnimationFrame(up); } }, { passive: true });
      up();
    }

    // Scroll progress bar
    const bar = document.createElement('div'); bar.className = 'prog'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar);
    const sp = () => bar.style.setProperty('--sp', scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
    addEventListener('scroll', sp, { passive: true }); sp();

  }
  try { sessionStorage.setItem('dcs', '1'); } catch (e) {}
})();
