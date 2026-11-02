(() => {
  'use strict';
  const app = document.getElementById('app');
  let csrf = '', me = '', tab = 'projects', lang = 'en', totpOn = false;
  const isAr = () => lang === 'ar';

  // Safe DOM builder: all text goes through text nodes, never innerHTML.
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };

  let noteTimer;
  const note = (msg, bad) => {
    document.querySelector('.note')?.remove();
    const n = h('div', { class: 'note' + (bad ? ' err' : ''), role: 'status' }, msg);
    document.body.append(n);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => n.remove(), bad ? 6000 : 2500);
  };

  const api = async (path, method = 'GET', body, file) => {
    const o = { method, credentials: 'same-origin', headers: { 'x-csrf': csrf } };
    if (file) {
      if (file.size > 6 * 1024 * 1024) throw new Error('That image is larger than 6 MB. Please choose a smaller one.');
      o.body = file;
      o.headers['x-filename'] = file.name;
    } else if (body !== undefined) {
      o.body = JSON.stringify(body);
      o.headers['content-type'] = 'application/json';
    }

    const r = await fetch('/api/admin/' + path + (isAr() && (path === 'site' || path === 'projects') ? '?lang=ar' : ''), o);
    const j = await r.json().catch(() => ({}));

    if (!r.ok) {
      if (r.status === 401 && path !== 'login') {
        csrf = '';
        loginView();
      }
      throw new Error(j.error || 'Request failed');
    }

    return j;
  };

  const busy = async (btn, fn, ok) => {
    btn.disabled = true;
    try {
      await fn();
      if (ok) note(ok);
    } catch (e) {
      note(e.message, true);
    } finally {
      btn.disabled = false;
    }
  };

  const field = (label, value, set, o = {}) => {
    const id = o.id || 'f' + Math.random().toString(36).slice(2, 8);
    const txt = o.type === undefined || o.type === 'text';
    const el = o.area
      ? h('textarea', { id, dir: 'auto' })
      : h('input', {
          id,
          type: o.type || 'text',
          list: o.list,
          autocomplete: 'off',
          dir: txt ? 'auto' : null
        });

    el.value = value ?? '';

    // While translating, show the English original and flag texts that are still English.
    const ref = typeof o.ref === 'string' && o.ref.trim() ? o.ref : '';
    const wrap = h('div', {});
    const mark = () => wrap.classList.toggle('same', !!ref && /[A-Za-z]{3}/.test(ref) && el.value.trim() === ref.trim());
    el.addEventListener('input', () => { set(el.value); mark(); });
    mark();

    wrap.append(...[
      h('label', { for: id }, label),
      el,
      ref ? h('p', { class: 'ref', dir: 'ltr', lang: 'en' }, 'English: ' + ref) : null,
      o.hint ? h('p', { class: 'hint' }, o.hint) : null
    ].filter(Boolean));
    return wrap;
  };

  const check = (label, value, set) => {
    const id = 'c' + Math.random().toString(36).slice(2, 8);
    const el = h('input', { id, type: 'checkbox' });
    el.checked = !!value;
    el.addEventListener('change', () => set(el.checked));

    return h('div', { class: 'check' }, el, h('label', { for: id }, label));
  };

  const lines = (label, arr, set, hint) =>
    field(
      label,
      (arr || []).join('\n'),
      v => set(v.split('\n').map(x => x.trim()).filter(Boolean)),
      { area: true, hint: hint || 'One item per line.' }
    );

  const slugify = s =>
    s.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);


  // ---------- login ----------

  function loginView() {
    const email = h('input', {
      id: 'e',
      type: 'email',
      autocomplete: 'username',
      required: true
    });

    const pw = h('input', {
      id: 'p',
      type: 'password',
      autocomplete: 'current-password',
      required: true
    });

    const code = h('input', {
      id: 'c2',
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      maxlength: '24',
      placeholder: '123456'
    });

    const btn = h('button', { type: 'submit' }, 'Sign in');

    const form = h(
      'form',
      {
        class: 'login',
        onsubmit: ev => {
          ev.preventDefault();

          busy(btn, async () => {
            const r = await api('login', 'POST', {
              email: email.value,
              password: pw.value,
              code: code.value
            });

            csrf = r.csrf;
            me = r.email;
            totpOn = !!r.totp;
            pw.value = code.value = '';
            shell();
          });
        }
      },
      h('img', { src: '/assets/img/logo.png', alt: 'dev.commit' }),
      h('h1', {}, 'Admin sign in'),
      h('label', { for: 'e' }, 'Email'),
      email,
      h('label', { for: 'p' }, 'Password'),
      pw,
      h('label', { for: 'c2' }, 'Authentication code (only if two-factor is on)'),
      code,
      h('p', { class: 'hint' }, 'Use the 6-digit code from your authenticator app, or a one-time recovery code.'),
      h('div', { class: 'row' }, btn)
    );

    app.replaceChildren(form);
    email.focus();
  }


  // ---------- shell ----------

  function shell() {
    const tabs = [
      ['projects', 'Projects'],
      ['site', 'Website Builder'],
      ['inbox', 'Leads / Inbox'],
      ['clients', 'Clients'],
      ['analytics', 'Analytics'],
      ['security', 'Security'],
      ['account', 'Account']
    ];


    const main = h('main');

    const langSwitch = ['projects', 'site'].includes(tab)
      ? h(
          'div',
          { class: 'langsw', role: 'group', 'aria-label': 'Editing language' },
          h('span', {}, 'Editing:'),
          [['en', 'English'], ['ar', 'العربية']].map(([k, l]) =>
            h('button', {
              class: 'ghost' + (lang === k ? ' on' : ''),
              'aria-pressed': String(lang === k),
              lang: k,
              onclick: () => { lang = k; shell(); }
            }, l)
          )
        )
      : null;

    const nav = h(
      'div',
      { class: 'tabs', role: 'tablist' },
      tabs.map(([k, l]) =>
        h(
          'button',
          {
            role: 'tab',
            class: k === tab ? 'on' : '',
            'aria-selected': String(k === tab),
            onclick: () => {
              tab = k;
              shell();
            }
          },
          l
        )
      )
    );

    app.replaceChildren(
      h(
        'div',
        { class: 'top' },
        h('img', { src: '/assets/img/logo.png', alt: 'dev.commit' }),
        nav,
        h('span', { class: 'sp' }),
        langSwitch,
        h('small', {}, me),
        h('a', {
          class: 'btn ghost',
          href: isAr() ? '/ar/' : '/',
          target: '_blank',
          rel: 'noopener'
        }, 'View site'),
        h('button', {
          class: 'ghost',
          onclick: async () => {
            try {
              await api('logout', 'POST');
            } catch {
              // ignore
            }
            csrf = '';
            loginView();
          }
        }, 'Sign out')
      ),
      main
    );

    ({
      projects: projectsView,
      site: siteView,
      inbox: inboxView,
      clients: clientsView,
      analytics: analyticsView,
      security: securityView,
      account: accountView
    })[tab](main).catch(e => note(e.message, true));
  }


  // ---------- projects ----------

  async function projectsView(main) {
    const AR = isAr();
    let [projects, site, images, enProjects] = await Promise.all([
      api('projects'),
      api('site'),
      api('images'),
      AR ? api('projects?lang=en') : null
    ]);

    let sel = 0;
    const enOf = p => (enProjects || []).find(x => x.slug === p.slug) || {};

    const arEditor = p => {
      const en = enOf(p);
      const tf = (label, key, area) => field(label, p[key], v => { p[key] = v; }, { area, ref: en[key] });
      const ln = (label, key) => field(
        label,
        (p[key] || []).join('\n'),
        v => { p[key] = v.split('\n').map(x => x.trim()); },
        { area: true, ref: (en[key] || []).join(' · '), hint: 'One item per line, in the same order as the English list.' }
      );
      return h(
        'div',
        { class: 'card', lang: 'ar' },
        h('h2', { dir: 'auto' }, p.title || en.title || ''),
        h('p', { class: 'hint', lang: 'en', dir: 'ltr' }, 'Arabic version. Fields still in English are highlighted; leave a field unchanged to show the English text.'),
        tf('Title', 'title'),
        tf('Client', 'client'),
        tf('Short summary', 'summary', true),
        tf('Overview', 'overview', true),
        tf('Approach', 'approach', true),
        ln('Services delivered', 'services'),
        ln('Goals', 'goals'),
        ln('Challenges', 'challenges'),
        ln('Verified outcomes', 'outcomes')
      );
    };

    const blank = () => ({
      slug: '',
      title: '',
      category: (site.categories || [])[0] || '',
      summary: '',
      client: '',
      url: '',
      image: '',
      mobileImage: '',
      featured: false,
      demo: false,
      services: [],
      overview: '',
      goals: [],
      challenges: [],
      approach: '',
      tech: [],
      outcomes: [],
      _new: true
    });

    const draw = () => {
      const p = projects[sel];

      const listEl = h(
        'div',
        { class: 'list' },
        projects.map((x, i) =>
          h(
            'div',
            { class: 'item' + (i === sel ? ' on' : '') },
            h(
              'button',
              {
                class: 't',
                onclick: () => {
                  sel = i;
                  draw();
                }
              },
              x.title || '(untitled)',
              x.demo && h('span', { class: 'badge' }, 'demo')
            ),
            !AR && h('button', {
              class: 'ghost m',
              'aria-label': 'Move up',
              disabled: i === 0,
              onclick: () => {
                [projects[i - 1], projects[i]] =
                  [projects[i], projects[i - 1]];
                sel = i - 1;
                draw();
              }
            }, '▲'),
            !AR && h('button', {
              class: 'ghost m',
              'aria-label': 'Move down',
              disabled: i === projects.length - 1,
              onclick: () => {
                [projects[i + 1], projects[i]] =
                  [projects[i], projects[i + 1]];
                sel = i + 1;
                draw();
              }
            }, '▼')
          )
        )
      );

      if (!AR) listEl.append(
        h(
          'div',
          { class: 'row' },
          h('button', {
            onclick: () => {
              projects.push(blank());
              sel = projects.length - 1;
              draw();
            }
          }, '+ Add project')
        )
      );

      const saveBtn = h('button', {}, 'Save all changes');

      saveBtn.addEventListener('click', () =>
        busy(saveBtn, async () => {
          await api(
            'projects',
            'PUT',
            projects.map(({ _new, ...x }) => x)
          );

          projects = await api('projects');
          sel = Math.min(sel, projects.length - 1);
          draw();
        }, 'Saved. The site has been rebuilt.')
      );

      const editor = p && AR ? arEditor(p) : p
        ? h(
            'div',
            { class: 'card' },
            h('h2', {}, p.title || 'New project'),

            h(
              'div',
              { class: 'grid2' },
              field('Title', p.title, v => {
                p.title = v;

                if (p._new && !p._slugEdited) {
                  p.slug = slugify(v);
                  const s = document.getElementById('slug');
                  if (s) s.value = p.slug;
                }
              }),

              h(
                'div',
                {},
                field('URL slug', p.slug, v => {
                  p.slug = v;
                  p._slugEdited = true;
                }, {
                  id: 'slug',
                  hint: 'Lowercase letters, numbers, hyphens. Used in /work/slug/.'
                })
              )
            ),

            h(
              'div',
              { class: 'grid2' },
              field('Category', p.category, v => {
                p.category = v;
              }, {
                list: 'cats',
                hint: 'Must match a category in Site settings for the filter button to appear.'
              }),

              field('Client (optional)', p.client, v => {
                p.client = v;
              })
            ),

            h(
              'datalist',
              { id: 'cats' },
              (site.categories || []).map(c =>
                h('option', { value: c })
              )
            ),

            field('Short summary', p.summary, v => {
              p.summary = v;
            }, { area: true }),

            field('Live website URL (optional)', p.url, v => {
              p.url = v;
            }, { hint: 'Must start with https://' }),

            imageField('Desktop screenshot (16:10, e.g. 1600×1000)', p, 'image'),

            imageField('Mobile screenshot (9:16, optional)', p, 'mobileImage'),

            check('Featured (shown in the home hero)', p.featured, v => {
              p.featured = v;
            }),

            check('This is demo content (shows a "Demo" badge)', p.demo, v => {
              p.demo = v;
            }),

            h(
              'details',
              {},
              h('summary', {}, 'Case study details (optional)'),

              field('Overview', p.overview, v => {
                p.overview = v;
              }, { area: true }),

              field('Approach', p.approach, v => {
                p.approach = v;
              }, { area: true }),

              lines('Services delivered', p.services, v => {
                p.services = v;
              }),

              lines('Goals', p.goals, v => {
                p.goals = v;
              }),

              lines('Challenges', p.challenges, v => {
                p.challenges = v;
              }),

              lines('Built with', p.tech, v => {
                p.tech = v;
              }),

              lines('Verified outcomes', p.outcomes, v => {
                p.outcomes = v;
              }, 'Only real, verifiable results. One per line.')
            ),

            h(
              'div',
              { class: 'row' },
              h('button', {
                class: 'danger',
                onclick: () => {
                  if (confirm(`Delete "${p.title || 'this project'}"? It is removed when you save.`)) {
                    projects.splice(sel, 1);
                    sel = Math.max(0, sel - 1);
                    draw();
                  }
                }
              }, 'Delete project')
            )
          )
        : h('p', {}, 'No projects yet. Add your first one.');

      main.replaceChildren(
        h(
          'div',
          { class: 'row' },
          h('h1', {}, AR ? 'Projects (Arabic)' : 'Projects'),
          h('span', { class: 'sp' }),
          saveBtn
        ),
        h(
          'div',
          { class: 'split' },
          h('div', {}, listEl),
          editor
        )
      );
    };

    const imageField = (label, p, key) => {
      const prev = h('img', {
        class: 'thumb',
        alt: '',
        src: p[key] || '/assets/img/favicon.svg'
      });

      prev.hidden = !p[key];

      const file = h('input', {
        type: 'file',
        accept: 'image/jpeg,image/png,image/webp',
        class: 'sr',
        tabindex: '-1'
      });

      const set = v => {
        p[key] = v;
        prev.hidden = !v;
        if (v) prev.src = v;
      };

      const up = h('button', {
        class: 'ghost',
        type: 'button'
      }, 'Upload image…');

      up.addEventListener('click', () => file.click());

      file.addEventListener('change', () =>
        file.files[0] && busy(up, async () => {
          const r = await api('upload', 'POST', undefined, file.files[0]);
          images.push(r.path);
          set(r.path);
          draw();
        }, 'Image uploaded. Remember to save.')
      );

      const pick = h(
        'select',
        { 'aria-label': 'Choose an existing image' },
        h('option', { value: '' }, 'Choose existing…'),
        images.map(i =>
          h('option', { value: i }, i.split('/').pop())
        )
      );

      pick.addEventListener('change', () => {
        if (pick.value) {
          set(pick.value);
        }
      });

      return h(
        'div',
        {},
        h('label', {}, label),
        prev,
        h(
          'div',
          { class: 'row' },
          up,
          pick,
          h('button', {
            class: 'ghost',
            type: 'button',
            onclick: () => set('')
          }, 'Remove')
        ),
        file
      );
    };

    draw();
  }


  // ---------- site settings ----------

  async function siteView(main) {
    const AR = isAr();
    const [site, images, enSite] = await Promise.all([
      api('site'),
      api('images'),
      AR ? api('site?lang=en') : null
    ]);
    site.ui ||= {};
    site.footer ||= {};

    site.theme ||= {
      background: '#FAF3E8',
      primary: '#2F5D50',
      accent: '#C8674A',
      surface: '#F1E6D3',
      text: '#2F5D50'
    };

    site.contactPage ||= {
      title: 'Get in Touch',
      text: 'Have a project in mind? Fill out the form and we will get back to you.',
      emailHeading: 'Email',
      submitLabel: 'Send inquiry',
      successMessage: 'Thank you. Your inquiry was sent and we will reply by email.',
      channels: [],
      extraFields: []
    };

    site.copy ||= {};
    site.hero ||= {};

    const set = (path, v) => {
      let x = site;

      path.slice(0, -1).forEach(k => {
        x[k] = x[k] || {};
        x = x[k];
      });

      x[path.at(-1)] = v;
    };

    const get = path =>
      path.reduce((x, k) => x == null ? '' : x[k], site);

    const enGet = path => path.reduce((x, k) => x == null ? '' : x[k], enSite);
    const refOf = v => Array.isArray(v) ? v.join(' · ') : (typeof v === 'string' ? v : '');

    const f = (label, path, opt) =>
      field(label, get(path), v => set(path, v), { ref: AR ? refOf(enGet(path)) : undefined, ...opt });

    const listEditor = (title, key, makeRow, createItem, hint = '') => {
      const wrap = h('div', { class: 'card' });
      wrap.append = (...k) => Element.prototype.append.apply(wrap, k.filter(x => x != null && x !== false));
      const rows = h('div', { class: 'stack' });

      const draw = () => {
        rows.replaceChildren(
          ...(site[key] || []).map((item, i) =>
            makeRow(item, i, () => {
              site[key].splice(i, 1);
              draw();
            })
          )
        );
      };

      const add = h('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => {
          site[key] ||= [];
          site[key].push(createItem());
          draw();
        }
      }, '+ Add');

      wrap.append(
        h('h2', {}, title),
        hint ? h('p', { class: 'hint' }, hint) : null,
        rows,
        add
      );

      draw();
      return wrap;
    };

    const objEditor = (title, path, fields, createItem, hint = '') => {
      let arr = get(path);

      if (!Array.isArray(arr)) {
        arr = [];
        set(path, arr);
      }

      const wrap = h('div', { class: 'card' });
      wrap.append = (...k) => Element.prototype.append.apply(wrap, k.filter(x => x != null && x !== false));
      const rows = h('div', { class: 'stack' });

      const enArr = AR ? (enGet(path) || []) : [];

      const draw = () => {
        rows.replaceChildren(
          ...arr.map((item, i) => {
            const controls = fields.filter(([, , opt]) => !(AR && opt && opt.enOnly)).map(([label, key, opt]) => {
              const ref = AR ? refOf((enArr[i] || {})[key]) : undefined;
              return Array.isArray(item[key])
                ? field(
                    label,
                    item[key].join('\n'),
                    v => {
                      // Arabic lists keep their positions (blank lines stay blank); English lists drop blanks.
                      item[key] = v.split('\n').map(x => x.trim()).filter(x => AR || x);
                    },
                    { area: true, ref, ...(opt || {}) }
                  )
                : field(label, item[key], v => {
                    item[key] = v;
                  }, { ref, ...(opt || {}) });
            });

            const remove = h('button', {
              class: 'danger ghost',
              type: 'button',
              onclick: () => {
                arr.splice(i, 1);
                draw();
              }
            }, 'Remove');

            const flags = [];

            if (!AR && Object.prototype.hasOwnProperty.call(item, 'required')) {
              flags.push(check('Required field', item.required, v => {
                item.required = v;
              }));
            }

            if (!AR && Object.prototype.hasOwnProperty.call(item, 'approved')) {
              flags.push(check('Approved for public display', item.approved, v => {
                item.approved = v;
              }));
            }

            return h(
              'details',
              { class: 'editor-row', open: true },
              h('summary', {}, item.title || item.label || item.q || item.name || `${title} ${i + 1}`),
              ...controls,
              ...flags,
              !AR && h('div', { class: 'row' }, remove)
            );
          })
        );
      };

      const add = h('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => {
          arr.push(createItem());
          draw();
        }
      }, '+ Add');

      wrap.append(
        h('h2', {}, title),
        hint ? h('p', { class: 'hint' }, hint) : null,
        rows,
        AR ? null : add
      );

      draw();
      return wrap;
    };

    const save = h('button', {}, 'Save website changes');

    save.addEventListener('click', () =>
      busy(save, async () => {
        await api('site', 'PUT', site);
      }, 'Saved. Website pages have been rebuilt.')
    );

    const themeCard = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Theme & colors'),
      h('p', { class: 'hint' }, 'Change the site palette. The current cream, terracotta and forest-green colors are the defaults.'),
      h(
        'div',
        { class: 'grid2' },
        ...[
          ['Background', 'background'],
          ['Primary', 'primary'],
          ['Accent', 'accent'],
          ['Surface', 'surface'],
          ['Text', 'text']
        ].map(([label, key]) =>
          field(label, site.theme[key], v => site.theme[key] = v, { type: 'color' })
        )
      )
    );

    const general = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Website information'),
      f('Brand / site name', ['name']),
      f('Browser title', ['title']),
      f('Site description', ['description'], { area: true }),
      f('Website URL', ['siteUrl'], { hint: 'Used for canonical links and sitemap.' }),
      check('Offer the Arabic version of the website (language switcher and /ar/ pages)', site.arabic !== false, v => {
        site.arabic = v;
      })
    );

    const generalAr = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Website information'),
      f('Browser title', ['title']),
      f('Site description', ['description'], { area: true })
    );

    // Contact information — Instagram, LinkedIn, TikTok and Facebook
    const contact = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Contact information'),

      h(
        'div',
        { class: 'grid2' },

        f('Public email', ['email'], { type: 'email' }),

        f('Instagram URL', ['social', 'instagram']),

        f('LinkedIn URL', ['social', 'linkedin']),

        f('TikTok URL', ['social', 'tiktok']),

        f('Facebook URL', ['social', 'facebook']),

        f('External form endpoint (optional)', ['formEndpoint'], {
          hint: 'Leave empty to use the built-in inbox form.'
        })
      ),

    );

    const footerCard = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Footer labels'),
      f('Navigation heading', ['footer', 'navigationTitle']),
      f('Services heading', ['footer', 'servicesTitle']),
      f('Contact heading', ['footer', 'contactTitle']),
      f('Copyright text', ['footer', 'copyright'])
    );

    const heroImageField = (label, key, hint) => {
      const preview = h('img', {
        class: 'thumb',
        alt: label + ' preview',
        src: site.hero[key] || '/assets/img/favicon.svg'
      });
      preview.hidden = !site.hero[key];

      const file = h('input', {
        type: 'file',
        accept: 'image/jpeg,image/png,image/webp',
        class: 'sr',
        tabindex: '-1'
      });

      const upload = h('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => file.click()
      }, 'Upload image…');

      const select = h('select', { 'aria-label': 'Choose existing ' + label.toLowerCase() },
        h('option', { value: '' }, 'Choose existing…'),
        images.map(src => h('option', { value: src }, src.split('/').pop()))
      );
      select.value = site.hero[key] || '';

      const apply = value => {
        site.hero[key] = value;
        preview.hidden = !value;
        preview.src = value || '/assets/img/favicon.svg';
        select.value = value;
      };

      file.addEventListener('change', () => {
        const selected = file.files && file.files[0];
        if (!selected) return;
        busy(upload, async () => {
          const result = await api('upload', 'POST', undefined, selected);
          if (!images.includes(result.path)) images.push(result.path);
          const option = h('option', { value: result.path }, result.path.split('/').pop());
          select.append(option);
          apply(result.path);
        }, 'Image uploaded. Remember to save website changes.');
        file.value = '';
      });

      select.addEventListener('change', () => {
        if (select.value) apply(select.value);
      });

      const remove = h('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => apply('')
      }, 'Remove');

      return h('div', {},
        h('label', {}, label),
        preview,
        hint ? h('p', { class: 'hint' }, hint) : null,
        h('div', { class: 'row' }, upload, select, remove),
        file
      );
    };

    const heroImages = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Hero images'),
      h('p', { class: 'hint' }, 'These images appear inside the laptop and phone mockups on the home page. Upload JPG, PNG or WebP images (max 6 MB).'),
      h('div', { class: 'grid2' },
        heroImageField('Desktop image', 'image', 'Recommended: landscape screenshot, around 16:10.'),
        heroImageField('Mobile image', 'mobileImage', 'Optional: portrait screenshot, around 9:16. If empty, the desktop image is used.')
      )
    );

    const home = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Home page content'),
      f('Hero eyebrow', ['hero', 'eyebrow']),
      f('Hero headline', ['hero', 'title']),
      f('Hero description', ['hero', 'text'], { area: true }),
      f('Primary button label', ['hero', 'primary', 'label']),
      ...(AR ? [] : [f('Primary button link', ['hero', 'primary', 'href'])]),
      f('Secondary button label', ['hero', 'secondary', 'label']),
      ...(AR ? [] : [f('Secondary button link', ['hero', 'secondary', 'href'])]),
      f('Featured work eyebrow', ['copy', 'featuredEyebrow']),
      f('Featured work title', ['copy', 'featuredTitle']),
      f('Big statement', ['statement'], { area: true }),
      f('Header button label', ['headerCta', 'label']),
      ...(AR ? [] : [f('Header button link', ['headerCta', 'href'])]),
      f('Bottom CTA title', ['cta', 'title']),
      f('Bottom CTA text', ['cta', 'text'], { area: true }),
      f('Bottom CTA button', ['cta', 'label']),
      ...(AR ? [] : [f('Bottom CTA link', ['cta', 'href'])])
    );

    site.marquee ||= { enabled: true, speed: 'normal', items: [] };
    const marqueeCard = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Moving services strip'),
      h('p', { class: 'hint' }, 'The strip loops horizontally without a visible jump. Leave the custom items empty to use the service names automatically.'),
      ...(AR ? [] : [
        check('Show moving strip', site.marquee.enabled !== false, v => { site.marquee.enabled = v; }),
        field('Movement speed (slow / normal / fast)', site.marquee.speed || 'normal', v => { site.marquee.speed = v.trim().toLowerCase(); }, { hint: 'Choose slow, normal or fast.' })
      ]),
      lines('Custom strip items (one per line)', site.marquee.items || [], v => { site.marquee.items = v; }, 'If you leave this empty, the strip uses the service titles above.')
    );

    const pages = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Page headings & copy'),
      f('Work page title', ['copy', 'workPageTitle']),
      f('Work page description', ['copy', 'workPageText'], { area: true }),
      f('Services page title', ['copy', 'servicesPageTitle']),
      f('Services page description', ['copy', 'servicesPageText'], { area: true }),
      f('About page title', ['copy', 'aboutPageTitle']),
      f('About page description', ['copy', 'aboutPageText'], { area: true }),
      f('Services section eyebrow', ['copy', 'servicesEyebrow']),
      f('Process section eyebrow', ['copy', 'processEyebrow']),
      f('Why section eyebrow', ['copy', 'whyEyebrow'])
    );

    const about = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'About page'),
      f('Mission', ['about', 'mission'], { area: true }),
      f('Design philosophy', ['about', 'design'], { area: true }),
      f('Development approach', ['about', 'development'], { area: true }),
      f('Our approach', ['about', 'approach'], { area: true })
    );

    const sections = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Sections visibility'),
      check('Show Why section', site.sections?.why !== false, v => {
        site.sections.why = v;
      }),
      check('Show testimonials', site.sections?.testimonials !== false, v => {
        site.sections.testimonials = v;
      }),
      check('Show FAQ', site.sections?.faq !== false, v => {
        site.sections.faq = v;
      }),
      check('Show demo projects', site.showDemoProjects !== false, v => {
        site.showDemoProjects = v;
      })
    );

    const servicesIntro = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Services page introduction'),
      f('Services intro title', ['servicesIntro', 'title']),
      f('Services intro text', ['servicesIntro', 'text'], { area: true }),
      f('Process intro title', ['processIntro', 'title']),
      f('Process intro text', ['processIntro', 'text'], { area: true }),
      f('Why section title', ['whyTitle'])
    );

    const services = objEditor(
      'Services (add, edit or remove)',
      ['services'],
      [
        ['Service title', 'title'],
        ['Short description', 'desc', { area: true }],
        ['Value statement', 'value', { area: true }],
        ['Deliverables (one per line)', 'deliverables', { area: true }]
      ],
      () => ({
        title: 'New service',
        desc: '',
        value: '',
        deliverables: []
      })
    );

    // Normalize textarea deliverables to/from newline strings for the repeater.
    const process = objEditor(
      'Process steps',
      ['process'],
      [
        ['Step title', 'title'],
        ['Step description', 'desc', { area: true }]
      ],
      () => ({
        title: 'New step',
        desc: ''
      })
    );

    const engagements = objEditor(
      'Ways to work together',
      ['engagements'],
      [
        ['Option title', 'title'],
        ['Description', 'desc', { area: true }]
      ],
      () => ({ title: 'New option', desc: '' })
    );

    const team = objEditor(
      'Team members',
      ['team'],
      [
        ['Name', 'name'],
        ['Role', 'role']
      ],
      () => ({ name: 'Team member', role: '' })
    );

    const legal = objEditor(
      'Footer legal links',
      ['legal'],
      [
        ['Link label', 'label'],
        ['Destination URL', 'href', { enOnly: true }]
      ],
      () => ({ label: 'Privacy policy', href: '/privacy/' })
    );

    const why = objEditor(
      'Why choose us',
      ['why'],
      [
        ['Title', 'title'],
        ['Description', 'desc', { area: true }]
      ],
      () => ({
        title: 'New reason',
        desc: ''
      })
    );

    const faq = objEditor(
      'FAQ (add, edit or remove)',
      ['faq'],
      [
        ['Question', 'q', { area: true }],
        ['Answer', 'a', { area: true }]
      ],
      () => ({
        q: 'New question',
        a: ''
      })
    );

    const nav = objEditor(
      'Navigation links',
      ['nav'],
      [
        ['Link label', 'label'],
        ['Destination URL', 'href', { enOnly: true }]
      ],
      () => ({
        label: 'New link',
        href: '/'
      })
    );

    const channels = objEditor(
      'Extra contact methods',
      ['contactPage', 'channels'],
      [
        ['Display name', 'label'],
        ['Displayed value (optional)', 'value'],
        ['Link (mailto:, tel:, https:// or URL)', 'href', { enOnly: true }]
      ],
      () => ({
        label: 'WhatsApp',
        value: '',
        href: 'https://wa.me/'
      }),
      'Add WhatsApp, phone, booking links, social profiles, or any other contact channel.'
    );

    const customFields = objEditor(
      'Additional contact form fields',
      ['contactPage', 'extraFields'],
      [
        ['Field label', 'label'],
        ['Field type: text/email/tel/url/number/textarea/select', 'type', { enOnly: true }],
        ['Options (one per line)', 'options', { area: true }]
      ],
      () => ({
        label: 'New field',
        type: 'text',
        required: false,
        options: []
      }),
      'Up to 15 extra fields. For select fields, enter options one per line.'
    );

    // Keep options as arrays while editing the newline-based control.
    const contactCopy = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Contact page content'),
      f('Page title', ['contactPage', 'title']),
      f('Page description', ['contactPage', 'text'], { area: true }),
      f('Email heading', ['contactPage', 'emailHeading']),
      f('Submit button label', ['contactPage', 'submitLabel']),
      f('Success message', ['contactPage', 'successMessage'], { area: true })
    );

    const contactLabels = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Contact form labels'),
      ...Object.entries({
        name: 'Name label',
        email: 'Email label',
        company: 'Company label',
        website: 'Website label',
        service: 'Service label',
        budget: 'Budget label',
        message: 'Message label',
        contactMethod: 'Preferred contact label',
        consent: 'Consent text'
      }).map(([key, label]) =>
        field(
          label,
          site.contactPage.labels?.[key] || ({
            name: 'Name',
            email: 'Email',
            company: 'Brand or company',
            website: 'Current website',
            service: 'Service needed',
            budget: 'Budget range',
            message: 'Project description',
            contactMethod: 'Preferred contact method',
            consent: 'I agree to be contacted about my inquiry.'
          })[key],
          v => {
            site.contactPage.labels ||= {};
            site.contactPage.labels[key] = v;
          }
        )
      )
    );

    const budgets = h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Contact form options'),
      lines('Budget options', site.budgets || [], v => {
        site.budgets = v;
      }, 'One budget option per line.'),
      lines('Project categories / filters', site.categories || [], v => {
        site.categories = v;
      }, 'One category per line. Used by portfolio filters.')
    );

    const testimonials = objEditor(
      'Testimonials',
      ['testimonials'],
      [
        ['Client name', 'name'],
        ['Role / company', 'role'],
        ['Quote', 'quote', { area: true }]
      ],
      () => ({
        name: 'Client name',
        role: '',
        quote: '',
        approved: false
      }),
      'Testimonials only appear publicly when approved is true. Use the advanced editor to approve them.'
    );

    const adv = h('textarea', {
      'aria-label': 'Advanced JSON',
      spellcheck: 'false'
    });

    adv.value = JSON.stringify(site, null, 2);
    adv.style.minHeight = '420px';

    const advBtn = h('button', {
      class: 'ghost'
    }, 'Save advanced JSON');

    advBtn.addEventListener('click', () =>
      busy(advBtn, async () => {
        let d;

        try {
          d = JSON.parse(adv.value);
        } catch {
          throw new Error('That is not valid JSON.');
        }

        await api('site', 'PUT', d);
      }, 'Advanced settings saved. Reload this tab to refresh the editor.')
    );

    const humanize = k => k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
    const interfaceTexts = h(
      'details',
      { class: 'card' },
      h('summary', {}, 'Interface texts (buttons, small labels, messages)'),
      h('p', { class: 'hint' }, AR
        ? 'Small texts used across the Arabic pages. They already have Arabic defaults; change them only if you want different wording.'
        : 'Small texts used across the English pages. {name} is replaced by the brand name.'),
      h('div', { class: 'grid2' }, Object.keys(site.ui).sort().map(k => f(humanize(k), ['ui', k])))
    );

    const arBanner = h(
      'div',
      { class: 'card banner-ar', lang: 'en' },
      h('strong', {}, 'You are editing the Arabic version.'),
      h('p', { class: 'hint' }, 'Under each field you can see the English original. Fields still identical to English are highlighted. Links, colors, images and the structure of lists (adding or removing items) are managed in English mode and apply to both languages. Anything left in English falls back to the English text automatically.')
    );

    const cards = AR
      ? [arBanner, generalAr, home, marqueeCard, pages, about, team, servicesIntro, services, process, engagements, why, faq, nav, legal, contactCopy, contactLabels, channels, customFields, budgets, testimonials, footerCard, interfaceTexts]
      : [themeCard, general, contact, footerCard, heroImages, home, marqueeCard, pages, about, team, servicesIntro, services, process, engagements, why, faq, nav, legal, contactCopy, contactLabels, channels, customFields, budgets, sections, testimonials, interfaceTexts];

    main.replaceChildren(
      h(
        'div',
        { class: 'row' },
        h('h1', {}, AR ? 'Website Builder (Arabic)' : 'Website Builder'),
        h('span', { class: 'sp' }),
        save
      ),

      h(
        'p',
        { class: 'hint' },
        AR
          ? 'Translate the text of every section. Changes go live after saving.'
          : 'Edit the website content, theme, services, contact page and navigation here. Changes go live after saving. The Arabic version uses the same structure; switch to العربية above to translate.'
      ),

      ...cards,

      AR ? null : h(
        'details',
        { class: 'card' },
        h('summary', {}, 'Advanced settings (JSON)'),
        h('p', { class: 'hint' }, 'For advanced fields not covered by the visual editor. Keep a backup before editing.'),
        adv,
        h('div', { class: 'row' }, advBtn)
      )
    );
  }


  // ---------- leads / inbox ----------

  async function inboxView(main) {
    const list = await api('inquiries');

    const statuses = [
      'new',
      'contacted',
      'qualified',
      'converted',
      'archived'
    ];

    const priorities = ['low', 'normal', 'high'];

    const exportLink = h('a', {
      class: 'btn ghost',
      href: '/api/admin/export',
      target: '_blank',
      rel: 'noopener'
    }, 'Export CSV');

    const cards = list.map(q => {
      const status = h(
        'select',
        { 'aria-label': 'Lead status' },
        statuses.map(x =>
          h('option', { value: x }, x[0].toUpperCase() + x.slice(1))
        )
      );

      status.value = q.status || 'new';

      const priority = h(
        'select',
        { 'aria-label': 'Lead priority' },
        priorities.map(x =>
          h('option', { value: x }, x[0].toUpperCase() + x.slice(1))
        )
      );

      priority.value = q.priority || 'normal';

      const notes = h('textarea', {
        'aria-label': 'Internal notes',
        placeholder: 'Internal notes…'
      });

      notes.value = q.notes || '';

      const save = h('button', {}, 'Save lead');

      const card = h(
        'div',
        { class: 'card' },

        h(
          'div',
          { class: 'row' },
          h('h3', {}, q.name, ' — ', q.company),
          h('span', { class: 'sp' }),
          h('span', { class: 'badge' }, q.priority || 'normal')
        ),

        h(
          'p',
          { class: 'hint' },
          new Date(q.at).toLocaleString(),
          ' · ',
          q.service,
          q.budget ? ' · ' + q.budget : ''
        ),

        h(
          'p',
          {},
          h('a', { href: 'mailto:' + q.email }, q.email),
          q.website && h(
            'span',
            {},
            ' · ',
            h('a', {
              href: q.website,
              target: '_blank',
              rel: 'noopener noreferrer'
            }, q.website)
          ),
          q.contact_method && h('span', {}, ' · prefers ', q.contact_method)
        ),

        h('div', { class: 'msg' }, q.message),

        q.customFields && Object.keys(q.customFields).length
          ? h(
              'div',
              { class: 'msg' },
              h('strong', {}, 'Additional form details'),
              ...Object.values(q.customFields).map(v =>
                h('p', {}, (v.label || 'Additional field') + ': ' + (v.value || ''))
              )
            )
          : null,

        h(
          'div',
          { class: 'grid2' },
          h('div', {}, h('label', {}, 'Status'), status),
          h('div', {}, h('label', {}, 'Priority'), priority)
        ),

        h('label', {}, 'Internal notes'),
        notes,
        h('div', { class: 'row' }, save)
      );

      save.addEventListener('click', () =>
        busy(save, async () => {
          await api(
            'inquiries/' + encodeURIComponent(q.id),
            'PATCH',
            {
              status: status.value,
              priority: priority.value,
              notes: notes.value
            }
          );
        }, 'Lead updated.')
      );

      return card;
    });

    main.replaceChildren(
      h(
        'div',
        { class: 'row' },
        h('h1', {}, `Leads (${list.length})`),
        h('span', { class: 'sp' }),
        exportLink
      ),

      h(
        'p',
        { class: 'hint' },
        'Manage incoming inquiries, track their sales status, add private notes, and export your leads.'
      ),

      list.length
        ? cards
        : h('div', { class: 'card' }, 'No leads yet. Messages from the contact form will appear here.')
    );
  }


  // ---------- client directory ----------

  async function clientsView(main) {
    let clients = await api('clients');

    const draw = () => {
      const name = h('input', {
        placeholder: 'Client name',
        required: true
      });

      const email = h('input', {
        type: 'email',
        placeholder: 'Email',
        required: true
      });

      const company = h('input', { placeholder: 'Company' });
      const phone = h('input', { placeholder: 'Phone' });
      const website = h('input', { placeholder: 'Website URL' });
      const notes = h('textarea', { placeholder: 'Private notes' });

      const add = h('button', {}, 'Add client');

      add.addEventListener('click', () =>
        busy(add, async () => {
          await api('clients', 'POST', {
            name: name.value,
            email: email.value,
            company: company.value,
            phone: phone.value,
            website: website.value,
            notes: notes.value
          });

          clients = await api('clients');
          draw();
        }, 'Client added.')
      );

      const cards = clients.map(c => {
        const nm = h('input', { value: c.name });
        const em = h('input', { type: 'email', value: c.email });
        const co = h('input', { value: c.company || '' });
        const ph = h('input', { value: c.phone || '' });
        const web = h('input', { value: c.website || '' });
        const nt = h('textarea', {});

        nt.value = c.notes || '';

        const save = h('button', {}, 'Save');
        const del = h('button', { class: 'danger' }, 'Delete');

        save.addEventListener('click', () =>
          busy(save, async () => {
            await api(
              'clients/' + encodeURIComponent(c.id),
              'PATCH',
              {
                name: nm.value,
                email: em.value,
                company: co.value,
                phone: ph.value,
                website: web.value,
                notes: nt.value
              }
            );
          }, 'Client updated.')
        );

        del.addEventListener('click', () =>
          confirm(`Delete ${c.name}?`) &&
          busy(del, async () => {
            await api('clients/' + encodeURIComponent(c.id), 'DELETE');
            clients = clients.filter(x => x.id !== c.id);
            draw();
          })
        );

        return h(
          'details',
          { class: 'card' },
          h('summary', {}, c.name + (c.company ? ' — ' + c.company : '')),

          h(
            'div',
            { class: 'grid2' },
            h('div', {}, h('label', {}, 'Name'), nm),
            h('div', {}, h('label', {}, 'Email'), em),
            h('div', {}, h('label', {}, 'Company'), co),
            h('div', {}, h('label', {}, 'Phone'), ph),
            h('div', {}, h('label', {}, 'Website'), web)
          ),

          h('label', {}, 'Private notes'),
          nt,

          h('div', { class: 'row' }, save, del)
        );
      });

      main.replaceChildren(
        h('div', { class: 'row' }, h('h1', {}, `Clients (${clients.length})`)),

        h(
          'div',
          { class: 'card' },
          h('h2', {}, 'Add a client'),
          h('div', { class: 'grid2' }, name, email, company, phone, website),
          h('label', {}, 'Private notes'),
          notes,
          h('div', { class: 'row' }, add)
        ),

        cards.length
          ? h('div', {}, cards)
          : h('div', { class: 'card' }, 'No clients yet. Add your first client above.')
      );
    };

    draw();
  }


  // ---------- analytics ----------

  async function analyticsView(main) {
    const data = await api('analytics');

    const days = Object.entries(data.days || {})
      .sort(([a], [b]) => a.localeCompare(b));

    const total = days.reduce((n, [, d]) => n + (d.views || 0), 0);

    const today = new Date().toISOString().slice(0, 10);
    const todayViews = data.days?.[today]?.views || 0;

    const pages = {};
    const sources = {};

    days.forEach(([, d]) => {
      Object.entries(d.pages || {}).forEach(([k, v]) => {
        pages[k] = (pages[k] || 0) + v;
      });

      Object.entries(d.referrers || {}).forEach(([k, v]) => {
        sources[k] = (sources[k] || 0) + v;
      });
    });

    const metric = (label, value) =>
      h(
        'div',
        { class: 'card metric' },
        h('p', { class: 'hint' }, label),
        h('strong', {}, String(value))
      );

    const ranking = (title, obj) =>
      h(
        'div',
        { class: 'card' },
        h('h2', {}, title),

        Object.entries(obj)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, v]) =>
            h(
              'div',
              { class: 'rank' },
              h('span', {}, k),
              h('strong', {}, String(v))
            )
          ),

        Object.keys(obj).length
          ? null
          : h('p', { class: 'hint' }, 'No data yet.')
      );

    const daily = days.slice(-14).reverse().map(([date, d]) =>
      h(
        'div',
        { class: 'rank' },
        h('span', {}, date),
        h('strong', {}, `${d.views || 0} views`)
      )
    );

    main.replaceChildren(
      h('h1', {}, 'Analytics'),

      h(
        'p',
        { class: 'hint' },
        'Privacy-friendly, aggregate page-view metrics. No visitor profiles, cookies, or stored IP addresses.'
      ),

      h(
        'div',
        { class: 'metrics' },
        metric('Total page views · last 90 days', total),
        metric('Views today', todayViews),
        metric('Days tracked', days.length)
      ),

      h(
        'div',
        { class: 'grid2' },
        ranking('Most viewed pages', pages),
        ranking('Traffic sources', sources)
      ),

      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Recent activity'),
        daily.length
          ? h('div', {}, daily)
          : h('p', { class: 'hint' }, 'Analytics will appear after visitors browse the website.')
      )
    );
  }


  // ---------- security / audit ----------

  async function securityView(main) {
    const events = await api('audit');

    const groups = [
      ['Sign-in', [
        'Passwords hashed with scrypt (32 MiB per attempt) and a unique salt; minimum 12 characters, common passwords refused',
        'Optional two-factor authentication (authenticator app) with one-time recovery codes and replay protection',
        'Sign-in throttling per address, per account and globally; the same work is done whether or not the account exists',
        'Sessions: HttpOnly, SameSite=Strict, Secure (__Host- prefix over HTTPS); 2-hour idle timeout, 12-hour maximum; all sessions end on password change'
      ]],
      ['Requests', [
        'CSRF token on every change plus a same-site (Origin / Fetch-Metadata) check on every write',
        'Strict Content-Security-Policy: no inline scripts or styles, no framing, no plugins',
        'HSTS, nosniff, no-referrer-leak, cross-origin isolation and permissions-policy headers',
        'Per-address request rate limits, request size limits and connection timeouts (slow-request protection)',
        'Optional admin IP allow-list (ADMIN_ALLOWED_IPS)'
      ]],
      ['Content & files', [
        'Every value is validated on the server and escaped on output; links are limited to http(s), mailto, tel and on-site paths',
        'Uploads are accepted by file signature only (JPG / PNG / WebP), randomly renamed, size- and count-limited',
        'CSV exports neutralise spreadsheet formulas; contact form has a honeypot, rate limits and sanitised fields',
        'Path-traversal and dot-file protection; data files are private (owner-only permissions)',
        'No third-party scripts, fonts or trackers; no stored IP addresses in analytics'
      ]]
    ];

    main.replaceChildren(
      h('h1', {}, 'Security'),

      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Two-factor authentication'),
        totpOn
          ? h('p', {}, 'Enabled. Sign-in needs your password and a code from your authenticator app.')
          : h('p', { class: 'warn' }, 'Not enabled yet. Turn it on under Account: it is the single biggest protection for the admin login.')
      ),

      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Active protections'),
        groups.map(([t, items]) => h('div', {}, h('h3', {}, t), h('ul', {}, items.map(x => h('li', {}, x))))),
        h('p', { class: 'hint' }, 'No website can honestly be called unhackable. These controls close the common attack routes; keep Node.js updated, use HTTPS, a strong unique password and two-factor authentication.')
      ),

      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Recent audit events'),

        events.length
          ? events.slice(0, 50).map(x =>
              h(
                'div',
                { class: 'rank' },
                h('span', {}, new Date(x.at).toLocaleString() + ' · ' + x.event + (x.ip ? ' · ' + x.ip : '')),
                h('strong', {}, x.email || x.leadId || x.file || 'System')
              )
            )
          : h('p', { class: 'hint' }, 'No audit events yet.')
      )
    );
  }


  // ---------- account ----------

  async function accountView(main) {
    const mk = (id, type, ac) => h('input', { type, autocomplete: ac, id });

    const cur = mk('cp', 'password', 'current-password');
    const n1 = mk('n1', 'password', 'new-password');
    const n2 = mk('n2', 'password', 'new-password');
    const btn = h('button', {}, 'Change password');

    btn.addEventListener('click', () =>
      busy(btn, async () => {
        if (n1.value !== n2.value) {
          throw new Error('New passwords do not match.');
        }

        await api('password', 'POST', {
          current: cur.value,
          next: n1.value
        });

        cur.value = n1.value = n2.value = '';
        csrf = '';
        note('Password changed. Please sign in again.');
        loginView();
      })
    );

    // ----- two-factor authentication -----
    const tf = h('div', { class: 'card' });

    const drawTf = (stage = {}) => {
      if (stage.recovery) {
        tf.replaceChildren(
          h('h2', {}, 'Two-factor authentication is on'),
          h('p', {}, 'Save these one-time recovery codes somewhere safe (a password manager is ideal). Each works once if you lose your phone. They will not be shown again.'),
          h('pre', { class: 'codes' }, stage.recovery.join('\n')),
          h('div', { class: 'row' }, h('button', { onclick: () => drawTf() }, 'I saved them'))
        );
        return;
      }

      if (stage.secret) {
        const code = h('input', { id: 'tc', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '8' });
        const go = h('button', {}, 'Turn on two-factor');

        go.addEventListener('click', () =>
          busy(go, async () => {
            const r = await api('2fa/enable', 'POST', { code: code.value });
            totpOn = true;
            drawTf({ recovery: r.recovery });
          })
        );

        tf.replaceChildren(
          h('h2', {}, 'Set up two-factor authentication'),
          h('p', {}, 'In an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…) choose "enter a setup key" and add this key (time-based, 6 digits):'),
          h('pre', { class: 'codes', dir: 'ltr' }, stage.secret.replace(/(.{4})/g, '$1 ').trim()),
          h('p', { class: 'hint' }, 'On a phone you can also open this link to add it directly:'),
          h('p', {}, h('a', { href: stage.uri, class: 'btn ghost' }, 'Open in authenticator app')),
          h('label', { for: 'tc' }, 'Enter the 6-digit code to confirm'),
          code,
          h('div', { class: 'row' }, go, h('button', { class: 'ghost', onclick: () => drawTf() }, 'Cancel'))
        );
        return;
      }

      if (totpOn) {
        const pw = mk('tp', 'password', 'current-password');
        const code = h('input', { id: 'td', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '24' });
        const off = h('button', { class: 'danger' }, 'Turn off two-factor');

        off.addEventListener('click', () =>
          busy(off, async () => {
            await api('2fa/disable', 'POST', { password: pw.value, code: code.value });
            totpOn = false;
            drawTf();
          }, 'Two-factor authentication turned off.')
        );

        tf.replaceChildren(
          h('h2', {}, 'Two-factor authentication'),
          h('p', {}, 'On. To turn it off, confirm with your password and a current code (or a recovery code).'),
          h('label', { for: 'tp' }, 'Password'),
          pw,
          h('label', { for: 'td' }, 'Authenticator or recovery code'),
          code,
          h('div', { class: 'row' }, off)
        );
        return;
      }

      const pw = mk('tp', 'password', 'current-password');
      const start = h('button', {}, 'Set up two-factor');

      start.addEventListener('click', () =>
        busy(start, async () => {
          const r = await api('2fa/setup', 'POST', { password: pw.value });
          drawTf({ secret: r.secret, uri: r.uri });
        })
      );

      tf.replaceChildren(
        h('h2', {}, 'Two-factor authentication'),
        h('p', {}, 'Off. Strongly recommended: after your password, sign-in will also need a 6-digit code from your phone.'),
        h('label', { for: 'tp' }, 'Confirm your password to begin'),
        pw,
        h('div', { class: 'row' }, start)
      );
    };

    drawTf();

    main.replaceChildren(
      h('h1', {}, 'Account'),

      tf,

      h(
        'div',
        { class: 'card' },

        h(
          'p',
          {},
          'Signed in as ',
          h('strong', {}, me),
          '. Sessions end after 2 hours of inactivity (12 hours at most) and are invalidated after a password change.'
        ),

        h('label', { for: 'cp' }, 'Current password'),
        cur,

        h('label', { for: 'n1' }, 'New password (min 12 characters)'),
        n1,

        h('label', { for: 'n2' }, 'Repeat new password'),
        n2,

        h('div', { class: 'row' }, btn)
      )
    );
  }


  // ---------- boot ----------

  fetch('/api/admin/me', { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (j) {
        csrf = j.csrf;
        me = j.email;
        totpOn = !!j.totp;
        shell();
      } else {
        loginView();
      }
    })
    .catch(loginView);

})();