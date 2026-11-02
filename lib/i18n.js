'use strict';
// Bilingual (English / Arabic) content helpers. No dependencies.
//
// How translation works:
//  * English is the source of truth: content/site.json and content/projects.json.
//  * Arabic lives in content/site.ar.json and content/projects.ar.json and only holds the
//    values that were actually translated. Anything missing falls back to the English value,
//    so editing English never leaves a blank Arabic page.
//  * Lists are matched by position (service #3 in English <-> service #3 in Arabic).
//  * Small interface texts (buttons, labels, headings) have built-in defaults per language below
//    and can be overridden from the admin panel.

const DEF = {
  en: {
    ui: {
      skip: 'Skip to content', menu: 'Menu', homeAria: '{name} home', ariaMain: 'Main', ariaFooter: 'Footer', ariaServices: 'Services',
      ariaBreadcrumb: 'Breadcrumb', ariaFilter: 'Filter by category', switchLabel: 'العربية', switchAria: 'Switch to Arabic',
      viewAll: 'View All Projects', viewProject: 'View Project', visitLive: 'Visit live site', newTab: '(opens in a new tab)', demo: 'Demo',
      kindWords: 'Kind words', searchProjects: 'Search projects', all: 'All', noMatch: 'No projects match your filters.',
      noProjects: 'New projects are on the way. In the meantime,', getInTouch: 'get in touch',
      crumbWork: 'Work', overview: 'Overview', client: 'Client', servicesH: 'Services', builtWith: 'Built with', goals: 'Goals',
      challenges: 'Challenges', approach: 'Approach', outcomes: 'Verified outcomes', onMobile: 'On mobile', related: 'Related projects',
      included: "What's included", startProject: 'Start a project', workflow: 'Typical workflow', waysToWork: 'Ways to work together',
      faqTitle: 'Frequently asked questions', aboutMission: 'Our mission', aboutPhilosophy: 'Our philosophy', aboutApproach: 'Our approach',
      team: 'Team', letsBuild: "Let's build something great.", exploreWork: 'Explore Our Work',
      notFoundTitle: 'Page not found', notFoundText: 'That page does not exist.', backHome: 'Back home', sendInquiryLink: 'Send an inquiry',
      optional: '(optional)', selectService: 'Select a service', preferNot: 'Prefer not to say', contactEmail: 'Email', videoCall: 'Video call',
      chooseOption: 'Choose an option', leaveEmpty: 'Leave empty', formOff: 'The inquiry form is not connected yet.',
      emailUsPrefix: 'Email us at', emailUsSuffix: 'in the meantime.', formAddEndpoint: 'Add a form endpoint in content/site.json to enable it.',
      useFormReply: 'Use the form and we will reply by email.', extraField: 'Additional field',
      msgRequired: 'Please complete the required fields.', msgSending: 'Sending…',
      msgError: 'Something went wrong sending your inquiry. Please try again or email us directly.',
      descWork: 'Selected Shopify storefront projects by {name}.', descServices: 'Shopify design, theme development, customization and support from {name}.',
      descAbout: 'About {name}, a digital studio for Shopify storefronts.', descContact: 'Tell us about your Shopify project.',
      pageWork: 'Work', pageServices: 'Services', pageAbout: 'About', pageContact: 'Contact'
    },
    copy: {
      featuredEyebrow: 'Featured projects', featuredTitle: 'Selected Work', servicesEyebrow: 'Our services', processEyebrow: 'Our process',
      whyEyebrow: 'Why {name}', workPageTitle: 'Our Work', workPageText: 'A selection of Shopify storefronts and the thinking behind them.',
      servicesPageTitle: 'Our Services', servicesPageText: 'End-to-end Shopify solutions to help you build, launch and grow your e-commerce brand.',
      aboutPageTitle: 'About {name}', aboutPageText: ''
    },
    footer: { navigationTitle: 'Navigate', servicesTitle: 'Services', contactTitle: 'Contact', copyright: 'All rights reserved.' },
    labels: {
      name: 'Name', email: 'Email', company: 'Brand or company', website: 'Current website', service: 'Service needed', budget: 'Budget range',
      message: 'Project description', contactMethod: 'Preferred contact method', consent: 'I agree to be contacted about my inquiry.'
    },
    email: { subject: 'We received your inquiry', hi: 'Hi {name},', body: 'Thank you for contacting dev.commit. We received your inquiry and will get back to you soon.' }
  },
  ar: {
    ui: {
      skip: 'انتقل إلى المحتوى', menu: 'القائمة', homeAria: 'الصفحة الرئيسية — {name}', ariaMain: 'القائمة الرئيسية', ariaFooter: 'روابط التذييل',
      ariaServices: 'الخدمات', ariaBreadcrumb: 'مسار التنقل', ariaFilter: 'التصفية حسب الفئة', switchLabel: 'English', switchAria: 'التبديل إلى اللغة الإنجليزية',
      viewAll: 'عرض كل المشاريع', viewProject: 'عرض المشروع', visitLive: 'زيارة الموقع المباشر', newTab: '(يُفتح في تبويب جديد)', demo: 'عرض تجريبي',
      kindWords: 'ماذا قالوا عنا', searchProjects: 'ابحث في المشاريع', all: 'الكل', noMatch: 'لا توجد مشاريع تطابق عوامل التصفية.',
      noProjects: 'مشاريع جديدة في الطريق. وفي الأثناء،', getInTouch: 'تواصل معنا',
      crumbWork: 'أعمالنا', overview: 'نظرة عامة', client: 'العميل', servicesH: 'الخدمات', builtWith: 'التقنيات المستخدمة', goals: 'الأهداف',
      challenges: 'التحديات', approach: 'منهجيتنا', outcomes: 'النتائج المؤكدة', onMobile: 'على الجوال', related: 'مشاريع ذات صلة',
      included: 'ما الذي يتضمنه', startProject: 'ابدأ مشروعك', workflow: 'سير العمل المعتاد', waysToWork: 'طرق التعاون معنا',
      faqTitle: 'الأسئلة الشائعة', aboutMission: 'مهمتنا', aboutPhilosophy: 'فلسفتنا', aboutApproach: 'نهجنا',
      team: 'الفريق', letsBuild: 'لنبنِ معاً شيئاً رائعاً.', exploreWork: 'استكشف أعمالنا',
      notFoundTitle: 'الصفحة غير موجودة', notFoundText: 'هذه الصفحة غير موجودة.', backHome: 'العودة إلى الرئيسية', sendInquiryLink: 'أرسل استفسارك',
      optional: '(اختياري)', selectService: 'اختر الخدمة', preferNot: 'أفضّل عدم الذكر', contactEmail: 'البريد الإلكتروني', videoCall: 'مكالمة فيديو',
      chooseOption: 'اختر أحد الخيارات', leaveEmpty: 'اتركه فارغاً', formOff: 'نموذج الاستفسار غير مفعّل بعد.',
      emailUsPrefix: 'راسلنا على', emailUsSuffix: 'في الأثناء.', formAddEndpoint: 'أضف رابط استقبال النموذج في content/site.json لتفعيله.',
      useFormReply: 'استخدم النموذج وسنردّ عليك عبر البريد الإلكتروني.', extraField: 'حقل إضافي',
      msgRequired: 'من فضلك أكمل الحقول المطلوبة.', msgSending: 'جارٍ الإرسال…',
      msgError: 'حدث خطأ أثناء إرسال استفسارك. حاول مرة أخرى أو راسلنا مباشرة عبر البريد الإلكتروني.',
      descWork: 'مجموعة مختارة من مشاريع متاجر شوبيفاي من {name}.', descServices: 'خدمات تصميم وتطوير وتخصيص ودعم متاجر شوبيفاي من {name}.',
      descAbout: 'تعرّف على {name}، استوديو رقمي متخصص في متاجر شوبيفاي.', descContact: 'حدّثنا عن مشروعك على شوبيفاي.',
      pageWork: 'أعمالنا', pageServices: 'خدماتنا', pageAbout: 'من نحن', pageContact: 'تواصل معنا'
    },
    copy: {
      featuredEyebrow: 'مشاريع مميّزة', featuredTitle: 'أعمال مختارة', servicesEyebrow: 'خدماتنا', processEyebrow: 'آلية عملنا',
      whyEyebrow: 'لماذا {name}', workPageTitle: 'أعمالنا', workPageText: 'مجموعة من متاجر شوبيفاي التي صمّمناها، والفكر الذي يقف خلفها.',
      servicesPageTitle: 'خدماتنا', servicesPageText: 'حلول شوبيفاي متكاملة تساعدك على بناء علامتك التجارية في التجارة الإلكترونية وإطلاقها وتنميتها.',
      aboutPageTitle: 'من نحن', aboutPageText: ''
    },
    footer: { navigationTitle: 'التنقل', servicesTitle: 'الخدمات', contactTitle: 'تواصل', copyright: 'جميع الحقوق محفوظة.' },
    labels: {
      name: 'الاسم', email: 'البريد الإلكتروني', company: 'العلامة التجارية أو الشركة', website: 'الموقع الحالي', service: 'الخدمة المطلوبة',
      budget: 'نطاق الميزانية', message: 'وصف المشروع', contactMethod: 'طريقة التواصل المفضلة', consent: 'أوافق على التواصل معي بخصوص استفساري.'
    },
    email: { subject: 'وصلنا استفسارك', hi: 'مرحباً {name}،', body: 'شكراً لتواصلك مع dev.commit. وصلنا استفسارك وسنعاود التواصل معك قريباً.' }
  }
};

// ---------- merge / diff ----------
const FORBID = new Set(['__proto__', 'constructor', 'prototype']);
// Fields that are not text and therefore never come from the Arabic file.
const NON_TR = new Set(['href', 'type', 'required', 'approved', 'slug', 'url', 'image', 'mobileImage', 'id', 'demo', 'featured']);
// Top-level keys of site.ar.json that may hold translations.
const AR_TOP = ['title', 'description', 'legal', 'nav', 'headerCta', 'hero', 'categories', 'services', 'process', 'why', 'testimonials', 'engagements', 'faq', 'about', 'team', 'budgets', 'cta', 'servicesIntro', 'processIntro', 'whyTitle', 'statement', 'marquee', 'contactPage'];
const GROUPS = ['copy', 'footer', 'ui'];
const PROJ_TR = ['title', 'client', 'summary', 'services', 'overview', 'goals', 'challenges', 'approach', 'outcomes'];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = o => JSON.parse(JSON.stringify(o ?? null));

function merge(en, ar) {
  if (ar == null || ar === '') return en;
  if (Array.isArray(en)) return Array.isArray(ar) ? en.map((x, i) => merge(x, ar[i])) : en;
  if (en && typeof en === 'object') {
    if (!ar || typeof ar !== 'object' || Array.isArray(ar)) return en;
    const out = {};
    for (const k of Object.keys(en)) out[k] = NON_TR.has(k) || FORBID.has(k) || !own(ar, k) ? en[k] : merge(en[k], ar[k]);
    return out;
  }
  return typeof en === 'string' && typeof ar === 'string' ? ar : en;
}

// Returns only what differs from English (null keeps list positions), or undefined if nothing differs.
function diff(en, cur, max = 5000) {
  if (Array.isArray(en)) {
    if (!Array.isArray(cur)) return undefined;
    const r = en.map((x, i) => { const d = diff(x, cur[i], max); return d === undefined ? null : d; });
    while (r.length && r[r.length - 1] === null) r.pop();
    return r.length ? r : undefined;
  }
  if (en && typeof en === 'object') {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    const r = {};
    for (const k of Object.keys(en)) { if (NON_TR.has(k) || FORBID.has(k)) continue; const d = diff(en[k], cur[k], max); if (d !== undefined) r[k] = d; }
    return Object.keys(r).length ? r : undefined;
  }
  if (typeof cur === 'string' && cur.trim() && cur !== en) { if (cur.length > max) { const e = new Error('A translated text is too long.'); e.pub = true; e.status = 400; throw e; } return cur.trim(); }
  return undefined;
}

const cleanGroup = o => { const r = {}; if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (!FORBID.has(k) && typeof v === 'string' && v.trim()) r[k] = v.trim(); return r; };
const diffGroup = (cur, defaults) => { const r = {}; for (const [k, v] of Object.entries(cleanGroup(cur))) if (v !== defaults[k] && v.length <= 2000) r[k] = v; return r; };

// Full site object for a language (what the page builder and the admin editor work with).
function resolveSite(en, arRaw, lang) {
  const src = lang === 'ar' ? (arRaw || {}) : en;
  let S;
  if (lang === 'ar') {
    const base = clone(en); for (const g of GROUPS) delete base[g]; if (base.contactPage) delete base.contactPage.labels;
    S = clone(merge(base, arRaw || {}));
  } else S = clone(en);
  for (const g of GROUPS) S[g] = { ...DEF[lang][g], ...cleanGroup(src[g]) };
  S.contactPage = { ...(S.contactPage || {}), labels: { ...DEF[lang].labels, ...cleanGroup(src.contactPage && src.contactPage.labels) } };
  return S;
}

// Reduce an edited site object back to what must be stored on disk.
function packSite(en, cur, lang) {
  if (lang === 'en') {
    const out = clone(cur);
    for (const g of GROUPS) { const d = diffGroup(cur[g], DEF.en[g]); if (Object.keys(d).length) out[g] = d; else delete out[g]; }
    if (out.contactPage) { const d = diffGroup(cur.contactPage && cur.contactPage.labels, DEF.en.labels); if (Object.keys(d).length) out.contactPage.labels = d; else delete out.contactPage.labels; }
    return out;
  }
  const out = {};
  for (const k of AR_TOP) { const d = diff(en[k], cur[k]); if (d !== undefined) out[k] = d; }
  for (const g of GROUPS) { const d = diffGroup(cur[g], DEF.ar[g]); if (Object.keys(d).length) out[g] = d; }
  const lab = diffGroup(cur.contactPage && cur.contactPage.labels, DEF.ar.labels);
  if (Object.keys(lab).length) (out.contactPage ||= {}).labels = lab;
  return out;
}

const pickTr = p => { const r = {}; for (const k of PROJ_TR) if (p[k] !== undefined) r[k] = p[k]; return r; };
const mergeProjects = (en, ar) => en.map(p => ({ ...p, ...merge(pickTr(p), ar && own(ar, p.slug) ? ar[p.slug] : null) }));
function packProjects(en, cur) {
  const out = {}; const bySlug = new Map((cur || []).map(p => [p && p.slug, p]));
  for (const p of en) { const c = bySlug.get(p.slug); if (!c) continue; const d = diff(pickTr(p), pickTr(c), 4000); if (d !== undefined) out[p.slug] = d; }
  return out;
}

const fill = (s, name) => String(s ?? '').replace(/\{name\}/g, name);

module.exports = { DEF, merge, diff, resolveSite, packSite, mergeProjects, packProjects, fill, clone, cleanGroup, AR_TOP, GROUPS, PROJ_TR };
