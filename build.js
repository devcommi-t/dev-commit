// <dev.commit> site generator: content/*.json -> dist/ (English at /, Arabic at /ar/). No dependencies. Node >= 18.
const fs = require('fs'), path = require('path'), http = require('http');
const I = require('./lib/i18n.js');
const R = __dirname, OUT = path.join(R, 'dist');
const rd = f => JSON.parse(fs.readFileSync(path.join(R, 'content', f), 'utf8'));
const rdOpt = (f, d) => { try { return rd(f); } catch (x) { if (x.code === 'ENOENT') return d; throw x; } };
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Only http(s), mailto, tel, in-site paths and anchors are allowed ("//host" is not an in-site path).
const safeUrl = s => /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/.test(s || '');
const HEX = /^#[0-9a-fA-F]{6}$/;
const NO_PREFIX = /^\/(assets|api|admin|\.well-known)(\/|$)/;

function build() {
  const S_en = rd('site.json');
  const P_en = rd('projects.json');
  const arabicOn = S_en.arabic !== false;
  const S_ar = I.resolveSite(S_en, rdOpt('site.ar.json', {}), 'ar');
  const P_ar = I.mergeProjects(P_en, rdOpt('projects.ar.json', {}));
  const S_enR = I.resolveSite(S_en, null, 'en');
  const SITE = (process.env.SITE_URL || S_en.siteUrl || '').replace(/\/$/, '');
  const ENDPOINT = process.env.FORM_ENDPOINT || S_en.formEndpoint || (process.env.SERVER_MODE ? '/api/contact' : '');
  if (process.env.NODE_ENV === 'production' && P_en.some(p => p.demo) && S_en.showDemoProjects) console.warn('WARNING: demo projects are included in a production build (set showDemoProjects to false).');
  P_en.forEach(p => { if (!/^[a-z0-9-]+$/.test(p.slug || '')) throw new Error('Invalid project slug: ' + p.slug); });

  const out = {};
  const ctx = { SITE, ENDPOINT, arabicOn, S_en: S_enR };
  Object.assign(out, render('en', S_enR, P_en, ctx));
  if (arabicOn) {
    const cat = c => { const i = (S_en.categories || []).indexOf(c); return i >= 0 && S_ar.categories && S_ar.categories[i] ? S_ar.categories[i] : c; };
    Object.assign(out, render('ar', S_ar, P_ar.map(p => ({ ...p, category: cat(p.category) })), ctx));
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  for (const [url, html] of Object.entries(out)) {
    const f = url.endsWith('.html') ? path.join(OUT, url) : path.join(OUT, url, 'index.html');
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html);
  }
  fs.cpSync(path.join(R, 'assets'), path.join(OUT, 'assets'), { recursive: true });

  // Theme colours live in a generated stylesheet so pages need no inline <style> (strict CSP).
  const th = { background: '#FAF3E8', primary: '#2F5D50', accent: '#C8674A', surface: '#F1E6D3', text: '#2F5D50', ...(S_en.theme || {}) };
  for (const k of Object.keys(th)) if (!HEX.test(th[k])) th[k] = { background: '#FAF3E8', primary: '#2F5D50', accent: '#C8674A', surface: '#F1E6D3', text: '#2F5D50' }[k];
  fs.writeFileSync(path.join(OUT, 'assets/css/theme.css'), `:root{--color-cream:${th.background};--color-forest:${th.primary};--color-terracotta:${th.accent};--color-terracotta-dark:color-mix(in srgb, ${th.accent} 78%, #000);--color-cream-deep:${th.surface};--color-line:${th.primary}33;--color-text:${th.text};color-scheme:light}body{color:var(--color-text)}\n`);

  const urls = Object.keys(out).filter(x => !x.endsWith('.html'));
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n${SITE ? `Sitemap: ${SITE}/sitemap.xml\n` : ''}`);
  if (SITE) {
    const neutral = x => x.replace(/^\/ar(\/|$)/, '/');
    const alt = x => arabicOn ? `<xhtml:link rel="alternate" hreflang="en" href="${e(SITE + neutral(x))}"/><xhtml:link rel="alternate" hreflang="ar" href="${e(SITE + '/ar' + neutral(x))}"/>` : '';
    fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.map(x => `<url><loc>${e(SITE + x)}</loc>${alt(x)}</url>`).join('')}</urlset>`);
  } else console.warn('Note: siteUrl is empty, so canonical URLs, Open Graph URLs and sitemap.xml were skipped.');
  if (S_en.email) {
    fs.mkdirSync(path.join(OUT, '.well-known'), { recursive: true });
    const exp = new Date(Date.now() + 300 * 864e5).toISOString();
    fs.writeFileSync(path.join(OUT, '.well-known/security.txt'), `Contact: mailto:${S_en.email}\nExpires: ${exp}\nPreferred-Languages: en, ar\n${SITE ? `Canonical: ${SITE}/.well-known/security.txt\n` : ''}`);
  }
  return check();
}

function render(lang, S, P, ctx) {
  const { SITE, ENDPOINT, arabicOn, S_en } = ctx;
  const AR = lang === 'ar', pre = AR ? '/ar' : '';
  const T = { ...I.DEF[lang].ui, ...(S.ui || {}) };
  // The brand name contains < > . which a right-to-left page would mirror; isolate it as left-to-right text.
  const NAME = AR ? '\u2066' + S.name + '\u2069' : S.name;
  const nm = s => I.fill(s, NAME);
  const iso = s => (AR ? String(s).split(S.name).join(NAME) : String(s));
  const u = s => { s = String(s || ''); if (!safeUrl(s)) return '#'; if (AR && s[0] === '/' && !NO_PREFIX.test(s) && !/^\/ar(\/|$)/.test(s)) s = '/ar' + s; return e(s); };
  const arrow = AR ? '←' : '→', arrowUp = '↗';
  if (!S.showDemoProjects) P = P.filter(p => !p.demo);
  const feat = P.find(p => p.featured) || P[0];
  const list = a => (a && a.length ? `<ul class="list">${a.map(x => `<li>${e(x)}</li>`).join('')}</ul>` : '');
  const socials = Object.entries(S.social || {}).filter(([, v]) => v);
  const CP = { title: 'Get in Touch', text: 'Have a project in mind? Fill out the form and we will get back to you.', submitLabel: 'Send inquiry', successMessage: 'Thank you. Your inquiry was sent and we will reply by email.', ...(S.contactPage || {}) };
  const contactChannels = Array.isArray(CP.channels) ? CP.channels : [];
  const CL = CP.labels, FT = S.footer;
  const extraFields = Array.isArray(CP.extraFields) ? CP.extraFields : [];
  const txt = key => { const v = nm(S.copy[key]); return v || (key === 'aboutPageText' ? S.description : ''); };
  const year = new Date().getFullYear();

  const logo = h => `<img src="/assets/img/logo.png" alt="${e(S.name)}" width="913" height="134" class="logo ${h}">`;
  const media = (p, eager) => {
    const ini = e([...String(p.title || '').replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).map(w => [...w][0]).join('')].slice(0, 2).join('').toUpperCase());
    return `<div class="media"><div class="ph" aria-hidden="true">${ini}</div>${p.image ? `<img src="${u(p.image)}" alt="${e(p.title)}${AR ? '' : ' storefront'}" ${eager ? '' : 'loading="lazy"'} decoding="async">` : ''}</div>`;
  };
  const card = p => `<article class="card" data-cat="${e(p.category)}" data-text="${e([p.title, p.client, p.summary, p.category].join(' ').toLowerCase())}">
<a class="card-link" href="${u('/work/' + p.slug + '/')}"><div class="folder">${media(p)}<div class="front"><p class="meta"><span class="cat">${e(p.category)}</span>${p.demo ? `<span class="badge">${e(T.demo)}</span>` : ''}</p><h3>${e(p.title)}</h3><p>${e(p.summary)}</p><span class="more">${e(T.viewProject)} <span aria-hidden="true">${arrow}</span></span></div></div></a>${p.url ? `<a class="live" href="${u(p.url)}" target="_blank" rel="noopener noreferrer">${e(T.visitLive)} <span aria-hidden="true">${arrowUp}</span><span class="sr"> ${e(T.newTab)}</span></a>` : ''}</article>`;
  const btn = (b, cls) => `<a class="btn ${cls || ''}" href="${u(b.href)}">${e(b.label)}</a>`;

  function page({ url, title, desc, body, img, ld, noindex }) {
    const full = title ? `${title} — ${NAME}` : iso(S.title);
    const d = desc || S.description;
    const full_url = SITE + pre + url;
    const canon = SITE ? `<link rel="canonical" href="${e(full_url)}">` : '';
    const neutral = url === '/404.html' ? '/' : url;
    const alts = SITE && arabicOn && !noindex ? `<link rel="alternate" hreflang="en" href="${e(SITE + neutral)}"><link rel="alternate" hreflang="ar" href="${e(SITE + '/ar' + neutral)}"><link rel="alternate" hreflang="x-default" href="${e(SITE + neutral)}">` : '';
    const og = `<meta property="og:title" content="${e(full)}"><meta property="og:description" content="${e(d)}"><meta property="og:type" content="website"><meta property="og:locale" content="${AR ? 'ar_AR' : 'en_US'}">${SITE ? `<meta property="og:url" content="${e(full_url)}"><meta property="og:image" content="${e(SITE + (img || '/assets/img/logo-original.jpg'))}">` : ''}<meta name="twitter:card" content="summary_large_image">`;
    const nav = S.nav.map(n => `<a href="${u(n.href)}"${n.href === url || (n.href !== '/' && url.startsWith(n.href)) ? ' aria-current="page"' : ''}>${e(n.label)}</a>`).join('');
    const switcher = arabicOn ? `<a class="lang" href="${e(AR ? neutral : '/ar' + neutral)}" hreflang="${AR ? 'en' : 'ar'}" lang="${AR ? 'en' : 'ar'}" aria-label="${e(T.switchAria)}">${e(T.switchLabel)}</a>` : '';
    const foot = `<footer class="foot"><div class="wrap foot-grid"><div><a href="${u('/')}" aria-label="${e(nm(T.homeAria))}">${logo('foot-logo')}</a><p class="muted">${e(S.description)}</p></div>
<nav aria-label="${e(T.ariaFooter)}"><h2 class="fh">${e(FT.navigationTitle)}</h2>${S.nav.map(n => `<a href="${u(n.href)}">${e(n.label)}</a>`).join('')}</nav>
<nav aria-label="${e(T.ariaServices)}"><h2 class="fh">${e(FT.servicesTitle)}</h2>${S.services.slice(0, 5).map(s => `<a href="${u('/services/')}">${e(s.title)}</a>`).join('')}</nav>
<div><h2 class="fh">${e(FT.contactTitle)}</h2>${S.email ? `<a href="mailto:${e(S.email)}" class="ltr">${e(S.email)}</a>` : `<a href="${u('/contact/')}">${e(T.sendInquiryLink)}</a>`}${socials.map(([k, v]) => `<a href="${u(v)}" rel="noopener noreferrer" target="_blank">${e(k[0].toUpperCase() + k.slice(1))}</a>`).join('')}</div></div>
<div class="wrap sub"><span>&copy; ${year} <span dir="auto">${e(S.name)}</span>. ${e(FT.copyright)}</span>${(S.legal || []).map(l => `<a href="${u(l.href)}">${e(l.label)}</a>`).join('')}</div></footer>`;
    return `<!doctype html><html lang="${lang}" dir="${AR ? 'rtl' : 'ltr'}"${arabicOn ? ' data-ar' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(full)}</title><meta name="description" content="${e(d)}">${noindex ? '<meta name="robots" content="noindex">' : ''}${canon}${alts}${og}
<meta name="theme-color" content="${e(HEX.test(S_en.theme && S_en.theme.background) ? S_en.theme.background : '#FAF3E8')}"><link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml"><script src="/assets/js/boot.js"></script><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/theme.css">${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}</head>
<body><a class="skip" href="#main">${e(T.skip)}</a>
<header class="head"><div class="wrap bar"><a href="${u('/')}" aria-label="${e(nm(T.homeAria))}">${logo('head-logo')}</a>
<button class="menu" aria-expanded="false" aria-controls="nav"><span class="sr">${e(T.menu)}</span><i></i></button>
<nav id="nav" class="nav" aria-label="${e(T.ariaMain)}">${nav}${switcher}${btn(S.headerCta, 'sm')}</nav></div></header>
<main id="main">${body}</main>${foot}<script src="/assets/js/main.js" defer></script></body></html>`;
  }

  const FL = ['f1', 'f2 c', 'f3 c', 'f4', 'f5', 'f6 c'];
  const floaters = () => `<div class="floaters" aria-hidden="true">${FL.map(c => `<i class="tile ${c}">${ICON}</i>`).join('')}</div>`;
  const cta = () => `<section class="band dark">${floaters()}<div class="wrap center"><h2>${e(S.cta.title)}</h2><p class="lead">${e(S.cta.text)}</p>${btn(S.cta, 'inv')}</div></section>`;
  const head = (t, sub) => `<div class="sec-head"><h2>${e(t)}</h2>${sub ? `<p class="lead">${e(sub)}</p>` : ''}</div>`;
  const steps = () => `<ol class="steps">${S.process.map((s, i) => `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><h3>${e(s.title)}</h3><p>${e(s.desc)}</p></li>`).join('')}</ol>`;
  const pageHero = (t, sub) => `<section class="wrap phero"><h1>${e(t)}</h1>${sub ? `<p class="lead">${e(sub)}</p>` : ''}</section>`;
  const ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>';
  const ico = `<span class="ico">${ICON}</span>`;
  const out = {};
  const K = url => pre + url;

  // HOME
  const H = S.hero;
  const heroDesktopImage = H.image || (feat && feat.image) || '';
  const heroMobileImage = H.mobileImage || (feat && feat.mobileImage) || heroDesktopImage;
  const heroMedia = { ...(feat || { title: 'dev.commit' }), image: heroDesktopImage };
  const heroPhoneMedia = { ...(feat || { title: 'dev.commit' }), image: heroMobileImage };
  const heroVisual = `<div class="visual"><i class="shape s1"></i><i class="shape s2"></i><div class="laptop"><div class="screen">${media(heroMedia, true)}</div><div class="base"></div></div>${(feat || heroDesktopImage || heroMobileImage) ? `<div class="phone">${media(heroPhoneMedia, true)}</div>` : ''}</div>`;
  const tests = (S.testimonials || []).filter(t => t.approved && t.quote);
  out[K('/')] = page({
    url: '/', ld: SITE ? { '@context': 'https://schema.org', '@type': 'Organization', name: S.name, url: SITE, logo: SITE + '/assets/img/logo.png', ...(socials.length ? { sameAs: socials.map(x => x[1]) } : {}) } : null,
    body: `<section class="wrap hero"><div><p class="eyebrow">${e(H.eyebrow)}</p><h1>${e(H.title).replace(/(\S+)$/, '<span class="acc">$1</span>')}</h1><p class="lead">${e(H.text)}</p><div class="row">${btn({ label: H.primary.label + ' ' + arrow, href: H.primary.href })}${btn(H.secondary, 'ghost')}</div></div>${heroVisual}</section>
${P.length ? `<section class="wrap sec"><div class="sec-head split"><div><p class="eyebrow">${e(txt('featuredEyebrow'))}</p><h2>${e(txt('featuredTitle'))}</h2></div><a class="link" href="${u('/work/')}">${e(T.viewAll)} <span aria-hidden="true">${arrow}</span></a></div><div class="grid">${P.slice(0, 3).map(card).join('')}</div></section>` : ''}
${S.statement ? `<section class="wrap statement"><p class="reveal-words">${S.statement.split(' ').map(w => `<span>${e(w)}</span>`).join(' ')}</p></section>` : ''}
${S.marquee?.enabled !== false ? (() => { const items = (S.marquee?.items || []).filter(x => typeof x === 'string' && x.trim()); const labels = items.length ? items : S.services.map(s => s.title); const speed = ['slow', 'normal', 'fast'].includes(S.marquee?.speed) ? S.marquee.speed : 'normal'; const track = labels.map(x => `<span>${e(x)}</span>`).join(''); return `<div class="marquee speed-${speed}" aria-hidden="true"><div>${track}${track}</div></div>`; })() : ''}
<section class="band dark"><div class="wrap"><div class="two"><div><p class="eyebrow lt">${e(txt('servicesEyebrow'))}</p><h2>${e(S.servicesIntro.title)}</h2></div><p class="lead">${e(S.servicesIntro.text)}</p></div><div class="svc-grid">${S.services.map(s => `<div class="svc">${ico}<div><h3>${e(s.title)}</h3><p>${e(s.desc)}</p></div></div>`).join('')}</div></div></section>
<section class="wrap sec"><div class="two"><div><p class="eyebrow">${e(txt('processEyebrow'))}</p><h2>${e(S.processIntro.title)}</h2></div><p class="lead">${e(S.processIntro.text)}</p></div>${steps()}</section>
${S.sections.why ? `<section class="wrap sec"><p class="eyebrow">${e(txt('whyEyebrow'))}</p><h2>${e(S.whyTitle)}</h2><div class="feats">${S.why.map(w => `<div>${ico}<div><h3>${e(w.title)}</h3><p>${e(w.desc)}</p></div></div>`).join('')}</div></section>` : ''}
${S.sections.testimonials && tests.length ? `<section class="wrap sec">${head(T.kindWords)}<div class="quotes">${tests.map(t => `<figure><blockquote>${e(t.quote)}</blockquote><figcaption>${e(t.name)}${t.role || t.company ? `${AR ? '،' : ','} ${e([t.role, t.company].filter(Boolean).join(AR ? ' – ' : ' at '))}` : ''}</figcaption></figure>`).join('')}</div></section>` : ''}
${cta()}`
  });

  // WORK
  out[K('/work/')] = page({
    url: '/work/', title: T.pageWork, desc: nm(T.descWork),
    body: `${pageHero(txt('workPageTitle'), txt('workPageText'))}<section class="wrap sec">
${P.length ? `<div class="filters"><label class="sr" for="q">${e(T.searchProjects)}</label><input id="q" type="search" placeholder="${e(T.searchProjects)}"><div role="group" aria-label="${e(T.ariaFilter)}"><button class="chip on" data-f="">${e(T.all)}</button>${S.categories.filter(c => P.some(p => p.category === c)).map(c => `<button class="chip" data-f="${e(c)}">${e(c)}</button>`).join('')}</div></div>
<div class="grid" id="grid">${P.map(card).join('')}</div><p id="empty" class="muted" hidden>${e(T.noMatch)}</p>` : `<p class="muted">${e(T.noProjects)} <a class="link" href="${u('/contact/')}">${e(T.getInTouch)}</a>.</p>`}</section>${cta()}`
  });
  P.forEach(p => {
    const rel = P.filter(x => x !== p && x.category === p.category).slice(0, 2);
    const blk = (t, c) => (c ? `<section><h2>${e(t)}</h2>${c}</section>` : '');
    out[K(`/work/${p.slug}/`)] = page({
      url: `/work/${p.slug}/`, title: p.title, desc: p.summary, img: p.image || undefined,
      body: `<section class="wrap phero"><nav class="crumb" aria-label="${e(T.ariaBreadcrumb)}"><a href="${u('/work/')}">${e(T.crumbWork)}</a> / ${e(p.title)}</nav><p class="eyebrow">${e(p.category)}${p.demo ? ' · ' + e(T.demo) : ''}</p><h1>${e(p.title)}</h1><p class="lead">${e(p.summary)}</p>${p.url ? `<p><a class="btn" href="${u(p.url)}" target="_blank" rel="noopener noreferrer">${e(T.visitLive)} ${arrowUp}<span class="sr"> ${e(T.newTab)}</span></a></p>` : ''}</section>
<div class="wrap">${media(p, true)}</div>
<div class="wrap case">${blk(T.overview, p.overview ? `<p>${e(p.overview)}</p>` : '')}
<aside class="facts">${p.client ? `<h3>${e(T.client)}</h3><p>${e(p.client)}</p>` : ''}${p.services?.length ? `<h3>${e(T.servicesH)}</h3>${list(p.services)}` : ''}${p.tech?.length ? `<h3>${e(T.builtWith)}</h3>${list(p.tech)}` : ''}</aside>
${blk(T.goals, list(p.goals))}${blk(T.challenges, list(p.challenges))}${blk(T.approach, p.approach ? `<p>${e(p.approach)}</p>` : '')}${blk(T.outcomes, list(p.outcomes))}
${p.mobileImage ? `<section><h2>${e(T.onMobile)}</h2><div class="shot">${media({ ...p, image: p.mobileImage })}</div></section>` : ''}</div>
${rel.length ? `<section class="wrap sec">${head(T.related)}<div class="grid">${rel.map(card).join('')}</div></section>` : ''}${cta()}`
    });
  });

  // SERVICES
  out[K('/services/')] = page({
    url: '/services/', title: T.pageServices, desc: nm(T.descServices),
    body: `${pageHero(txt('servicesPageTitle'), txt('servicesPageText'))}<section class="wrap sec split-svc"><div class="tabs" role="tablist" aria-label="${e(T.ariaServices)}">${S.services.map((s, i) => `<button type="button" role="tab" id="t${i}" aria-controls="p${i}" aria-selected="${i === 0}" class="tab${i === 0 ? ' on' : ''}">${ico}${e(s.title)}</button>`).join('')}</div><div>${S.services.map((s, i) => `<article class="panel" id="p${i}" role="tabpanel" aria-labelledby="t${i}"><h2>${e(s.title)}</h2><p>${e(s.desc)}</p><p class="val">${e(s.value)}</p><h3>${e(T.included)}</h3>${list(s.deliverables)}${btn({ label: T.startProject, href: '/contact/' })}</article>`).join('')}</div></section>
<section class="band tint"><div class="wrap">${head(T.workflow)}${steps()}</div></section>
<section class="wrap sec">${head(T.waysToWork)}<div class="why light">${S.engagements.map(g => `<div><h3>${e(g.title)}</h3><p>${e(g.desc)}</p></div>`).join('')}</div></section>
${S.sections.faq ? `<section class="wrap sec narrow">${head(T.faqTitle)}${S.faq.map(f => `<details><summary>${e(f.q)}</summary><p>${e(f.a)}</p></details>`).join('')}</section>` : ''}${cta()}`
  });

  // ABOUT
  const A = S.about;
  const blk2 = (t, c) => `<section><h2>${e(t)}</h2><p>${e(c)}</p></section>`;
  out[K('/about/')] = page({
    url: '/about/', title: T.pageAbout, desc: nm(T.descAbout),
    body: `${pageHero(txt('aboutPageTitle'), txt('aboutPageText'))}<section class="wrap sec"><div class="cols3">${[[T.aboutMission, A.mission], [T.aboutPhilosophy, A.design + ' ' + A.development], [T.aboutApproach, A.approach]].map(([t, c]) => blk2(t, c)).join('')}</div></section>
${(S.team || []).length ? `<section class="wrap sec">${head(T.team)}<div class="why light">${S.team.map(m => `<div><h3>${e(m.name)}</h3><p>${e(m.role)}</p></div>`).join('')}</div></section>` : ''}
<section class="wrap sec"><div class="banner"><h2>${e(T.letsBuild)}</h2><a class="btn inv" href="${u('/work/')}">${e(T.exploreWork)}</a></div></section>`
  });

  // CONTACT
  // Labels are shown in the page language; the submitted value is always the English one (what the admin reads).
  const opt = (a, vals) => a.map((x, i) => `<option${vals && vals[i] != null ? ` value="${e(vals[i])}"` : ''}>${e(x)}</option>`).join('');
  const enCP = S_en.contactPage || {};
  const fld = (id, label, extra = '', req) => `<div class="f"><label for="${id}">${label}${req ? ' <span aria-hidden="true">*</span>' : ` <span class="muted">${e(T.optional)}</span>`}</label>${extra}</div>`;
  const E = e;
  out[K('/contact/')] = page({
    url: '/contact/', title: T.pageContact, desc: T.descContact,
    body: `${pageHero(CP.title, CP.text)}<section class="wrap sec contact"><aside class="cinfo"><h2>${e(CP.emailHeading || T.contactEmail)}</h2>${S.email ? `<p><a class="link ltr" href="mailto:${e(S.email)}">${e(S.email)}</a></p>` : `<p class="muted">${e(T.useFormReply)}</p>`}${socials.map(([k, v]) => `<p><a class="link" href="${u(v)}" rel="noopener noreferrer" target="_blank">${e(k[0].toUpperCase() + k.slice(1))}</a></p>`).join('')}${contactChannels.map(c => `<p><a class="link" href="${u(c.href || '#')}" ${/^https?:/.test(c.href || '') ? 'target="_blank" rel="noopener noreferrer"' : ''}>${e(c.label)}${c.value ? ': ' + e(c.value) : ''}</a></p>`).join('')}</aside><form id="inquiry" method="post" action="${ENDPOINT ? u(ENDPOINT) : '#'}" ${ENDPOINT ? '' : 'data-off'} data-m-required="${E(T.msgRequired)}" data-m-sending="${E(T.msgSending)}" data-m-error="${E(T.msgError)}" novalidate>
${ENDPOINT ? '' : `<p class="note">${e(T.formOff)} ${S.email ? `${e(T.emailUsPrefix)} <a class="link ltr" href="mailto:${e(S.email)}">${e(S.email)}</a> ${e(T.emailUsSuffix)}` : e(T.formAddEndpoint)}</p>`}
<input type="hidden" name="lang" value="${lang}">
${fld('name', e(CL.name), '<input id="name" name="name" autocomplete="name" maxlength="120" required>', 1)}
${fld('email', e(CL.email), '<input id="email" name="email" type="email" autocomplete="email" maxlength="200" required>', 1)}
${fld('company', e(CL.company), '<input id="company" name="company" autocomplete="organization" maxlength="200" required>', 1)}
${fld('site', e(CL.website), '<input id="site" name="website" type="url" placeholder="https://" maxlength="300">')}
${fld('service', e(CL.service), `<select id="service" name="service" required><option value="">${e(T.selectService)}</option>${opt(S.services.map(s => s.title), S_en.services.map(s => s.title))}</select>`, 1)}
${(S.budgets || []).length ? fld('budget', e(CL.budget), `<select id="budget" name="budget"><option value="">${e(T.preferNot)}</option>${opt(S.budgets, S_en.budgets)}</select>`) : ''}
${fld('msg', e(CL.message), '<textarea id="msg" name="message" rows="6" required minlength="20" maxlength="5000"></textarea>', 1)}
${fld('pref', e(CL.contactMethod), `<select id="pref" name="contact_method"><option value="Email">${e(T.contactEmail)}</option><option value="Video call">${e(T.videoCall)}</option></select>`)}
${extraFields.map((x, i) => { const n = 'custom_' + i, label = e(x.label || (T.extraField + ' ' + (i + 1))), req = x.required ? ' required' : ''; if (x.type === 'textarea') return fld(n, label, `<textarea id="${n}" name="${n}" rows="4" maxlength="2000"${req}></textarea>`, x.required); if (x.type === 'select') return fld(n, label, `<select id="${n}" name="${n}"${req}><option value="">${e(T.chooseOption)}</option>${opt(x.options || [], ((enCP.extraFields || [])[i] || {}).options)}</select>`, x.required); const typ = ['text', 'email', 'tel', 'url', 'number'].includes(x.type) ? x.type : 'text'; return fld(n, label, `<input id="${n}" name="${n}" type="${typ}" maxlength="2000"${req}>`, x.required); }).join('')}
<div class="f hp" aria-hidden="true"><label for="_g">${e(T.leaveEmpty)}</label><input id="_g" name="_gotcha" tabindex="-1" autocomplete="off"></div>
<div class="f check"><input id="consent" name="consent" type="checkbox" required><label for="consent">${e(CL.consent)} <span aria-hidden="true">*</span></label></div>
<button class="btn" type="submit" ${ENDPOINT ? '' : 'disabled'}>${e(CP.submitLabel || 'Send inquiry')}</button><p id="status" data-success="${e(CP.successMessage)}" role="status" aria-live="polite"></p></form></section>`
  });
  out[K('/404.html')] = page({ url: '/404.html', title: T.notFoundTitle, noindex: true, body: `${pageHero(T.notFoundTitle, T.notFoundText)}<p class="wrap sec"><a class="btn" href="${u('/')}">${e(T.backHome)}</a></p>` });
  return out;
}

function check() {
  let bad = 0;
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]));
  for (const f of walk(OUT).filter(f => f.endsWith('.html'))) {
    const h = fs.readFileSync(f, 'utf8');
    for (const m of h.matchAll(/(?:href|src)="(\/(?!\/)[^"#?]*)/g)) {
      let t = path.join(OUT, m[1]);
      if (m[1].endsWith('/')) t = path.join(t, 'index.html');
      if (!fs.existsSync(t)) { console.error('BROKEN LINK', m[1], 'in', path.relative(OUT, f)); bad++; }
    }
    if (/\sstyle="/.test(h) || /<style[\s>]/.test(h)) { console.error('INLINE STYLE found in', path.relative(OUT, f), '(blocked by the Content-Security-Policy)'); bad++; }
  }
  console.log(bad ? `Link check: ${bad} problem(s)` : 'Link check: all internal links and assets resolve; no inline styles');
  return bad;
}

module.exports = { build };

if (require.main === module) {
  const bad = build();
  if (process.argv.includes('--serve')) {
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml', '.woff': 'font/woff' };
    let t; for (const d of ['content', 'assets']) fs.watch(path.join(R, d), { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => { try { build(); } catch (x) { console.error(x.message); } }, 150); });
    http.createServer((q, s) => {
      let p; try { p = decodeURIComponent(q.url.split('?')[0]); } catch { s.statusCode = 400; return s.end('Bad request'); }
      if (p.endsWith('/')) p += 'index.html';
      let f = path.join(OUT, path.normalize(p));
      if (!f.startsWith(OUT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.statusCode = 404; f = path.join(OUT, '404.html'); }
      s.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); s.end(fs.readFileSync(f));
    }).listen(3000, '127.0.0.1', () => console.log('Dev server: http://localhost:3000'));
  } else process.exit(bad ? 1 : 0);
}
