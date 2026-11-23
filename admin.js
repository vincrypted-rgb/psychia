(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let PASS = localStorage.getItem('circle_admin_pass') || '';
  let DB = null;
  const CONDS = [['', 'Unassigned'], ['named', 'Not anonymous'], ['pseudonym', 'Pseudonym'], ['anonymous', 'Anonymous']];
  const TYPES = [['neutral', 'Neutral'], ['good', 'Good post'], ['violation', 'Clear violation'], ['ambiguous', 'Ambiguous'], ['footprint', 'Digital footprint']];
  const isTrue = (v) => String(v).toUpperCase() === 'TRUE';

  /* ---------------- plumbing ---------------- */
  async function call(action, extra) {
    if (!api.ready()) throw new Error('API_URL is not set in js/config.js');
    const r = await api.post(Object.assign({ action: action, pass: PASS }, extra || {}));
    if (r.error) throw new Error(r.error);
    return r;
  }
  function setStatus(t, bad) { const s = $('status'); s.textContent = t; s.style.color = bad ? '#ffb3a8' : ''; if (t && !bad) setTimeout(() => { if (s.textContent === t) s.textContent = ''; }, 3500); }
  async function guard(label, fn) {
    try { setStatus(label + '…'); await fn(); setStatus(label + ' ✓'); }
    catch (e) { setStatus('Error: ' + e.message, true); alert('Error: ' + e.message); }
  }
  function modal(title, body, buttons) {
    const root = $('modal-root');
    const close = () => { root.textContent = ''; };
    root.textContent = '';
    root.append(h('div', { class: 'modal-bg' }, h('div', { class: 'modal' }, h('h2', {}, title), body,
      h('div', { class: 'row right' }, buttons.map((b) => h('button', { class: b.cls || '', onclick: () => (b.fn ? b.fn(close) : close()) }, b.label))))));
    return close;
  }
  function csvCell(v) {
    v = v === undefined || v === null ? '' : String(v);
    if (/^[=+\-@]/.test(v)) v = "'" + v;                  // neutralize spreadsheet formulas
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function downloadCsv(name, rows) {
    const text = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
    document.body.append(a); a.click(); a.remove();
  }
  function sel(opts, value, onchange) {
    const s = h('select', { onchange: (e) => onchange(e.target.value) }, opts.map((o) => h('option', { value: o[0] }, o[1])));
    s.value = value === undefined || value === null ? '' : value;
    return s;
  }
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const studyBase = () => new URL('index.html', location.href).href;

  /* ---------------- login ---------------- */
  async function loadAll() {
    const r = await call('admin_get');
    const settings = {}; r.settings.forEach((x) => { settings[x.key] = x.value === undefined ? '' : String(x.value); });
    DB = {
      settings: settings, users: r.users,
      posts: r.posts.sort((a, b) => Number(a.order) - Number(b.order)),
      comments: r.comments, participants: r.participants, events: null
    };
  }
  async function login() {
    PASS = $('pass').value || PASS;
    $('login-error').textContent = '';
    try {
      await loadAll();
      localStorage.setItem('circle_admin_pass', PASS);
      $('login').classList.add('hidden'); $('app').classList.remove('hidden');
      renderAll();
    } catch (e) {
      $('login-error').textContent = e.message === 'unauthorized' ? 'Wrong passphrase.' :
        e.message === 'admin_password_not_set' ? 'Set the ADMIN_PASS script property first (see README).' : e.message;
    }
  }
  $('login-btn').addEventListener('click', login);
  $('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('logout').addEventListener('click', () => { localStorage.removeItem('circle_admin_pass'); location.reload(); });
  if (PASS && api.ready()) { $('pass').value = PASS; login(); }

  /* ---------------- tabs ---------------- */
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#tabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    ['participants', 'feed', 'users', 'text', 'data', 'preview'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
  }));
  function renderAll() { renderParticipants(); renderFeed(); renderUsers(); renderText(); renderData(); renderPreview(); }

  /* ---------------- participants ---------------- */
  async function upsert(rows) {
    await guard('Saving participants', async () => { DB.participants = (await call('admin_upsertParticipants', { rows: rows })).participants; });
    renderParticipants();
  }
  function squareJpeg(src, w, h2) {
    const c = document.createElement('canvas'); c.width = c.height = 160;
    const s = Math.min(w, h2);
    c.getContext('2d').drawImage(src, (w - s) / 2, (h2 - s) / 2, s, s, 0, 0, 160, 160);
    return c.toDataURL('image/jpeg', 0.75);
  }
  async function photoFromFile(code, file) {
    if (!file) return;
    const bmp = await createImageBitmap(file);
    upsert([{ code: code, photo: squareJpeg(bmp, bmp.width, bmp.height) }]);
  }
  async function photoFromCamera(code) {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }
    catch (e) { alert('Could not open the camera: ' + e.message); return; }
    const video = h('video', { autoplay: true, playsinline: true });
    video.srcObject = stream;
    const stop = () => stream.getTracks().forEach((t) => t.stop());
    modal('Take photo', video, [
      { label: 'Cancel', fn: (close) => { stop(); close(); } },
      { label: 'Capture', cls: 'primary', fn: (close) => {
        const data = squareJpeg(video, video.videoWidth, video.videoHeight);
        stop(); close(); upsert([{ code: code, photo: data }]);
      } }]);
  }

  function renderParticipants() {
    const el = $('tab-participants'); el.textContent = '';
    const P = DB.participants;
    const n = (f) => P.filter(f).length;
    el.append(h('h2', {}, 'Participants'));
    el.append(h('div', { class: 'counts' },
      [['Total', P.length], ['Unassigned', n((p) => !p.condition)], ['Not anonymous', n((p) => p.condition === 'named')],
        ['Pseudonym', n((p) => p.condition === 'pseudonym')], ['Anonymous', n((p) => p.condition === 'anonymous')],
        ['Completed', n((p) => p.status === 'completed')], ['Withdrawn', n((p) => p.status === 'withdrawn')]]
        .map((c) => h('div', { class: 'c' }, h('b', {}, String(c[1])), c[0]))));

    const names = h('textarea', { rows: '4', placeholder: 'One participant name per line (as on the consent form)' });
    el.append(h('div', { class: 'card' },
      h('h3', {}, 'Add participants'), names,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => {
          const rows = names.value.split('\n').map((s) => s.trim()).filter(Boolean).map((name) => ({ name: name }));
          if (rows.length) upsert(rows);
        } }, 'Add'),
        h('button', { onclick: () => guard('Randomly assigning', async () => {
          const r = await call('admin_randomAssign'); DB.participants = r.participants; renderParticipants();
          setStatus('Assigned ' + r.assigned + ' participant(s)');
        }) }, 'Randomly assign unassigned (balanced)'),
        h('button', { onclick: () => {
          downloadCsv('participant_links.csv', [['name', 'code', 'condition', 'link']].concat(DB.participants.map((p) => [p.name, p.code, p.condition, studyBase() + '?code=' + p.code])));
        } }, 'Download links (CSV)'),
        h('button', { class: 'danger', onclick: () => {
          if (confirm('Delete ALL participant photos from the sheet?')) guard('Deleting photos', async () => { DB.participants = (await call('admin_deleteAllPhotos')).participants; renderParticipants(); });
        } }, 'Delete all photos')),
      h('div', { class: 'note' }, 'Assignment keeps the three groups as balanced as possible and only touches unassigned people. Photos are only shown to people in the "Not anonymous" group.')));

    const tbody = h('tbody', {});
    P.forEach((p) => {
      const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: (e) => photoFromFile(p.code, e.target.files[0]) });
      tbody.append(h('tr', {},
        h('td', {}, h('input', { type: 'text', value: p.name, onchange: (e) => upsert([{ code: p.code, name: e.target.value }]) })),
        h('td', { class: 'mono' }, String(p.code)),
        h('td', {}, sel(CONDS, p.condition, (v) => upsert([{ code: p.code, condition: v }]))),
        h('td', {}, h('div', { class: 'row' },
          p.photo ? h('img', { class: 'thumb', src: p.photo }) : h('div', { class: 'thumb' }),
          h('button', { class: 'small', onclick: () => photoFromCamera(p.code) }, 'Camera'),
          h('button', { class: 'small', onclick: () => file.click() }, 'File'), file)),
        h('td', {}, h('span', { class: 'pill ' + p.status }, String(p.status || 'created'))),
        h('td', {}, h('div', { class: 'row' },
          h('button', { class: 'small', onclick: () => { navigator.clipboard.writeText(studyBase() + '?code=' + p.code); setStatus('Link copied'); } }, 'Copy link'),
          h('button', { class: 'small', onclick: () => {
            if (confirm('Withdraw ' + p.name + '? Their events, photo and pseudonym are erased.')) guard('Removing data', async () => { DB.participants = (await call('admin_removeParticipantData', { code: p.code })).participants; renderParticipants(); });
          } }, 'Remove data'),
          h('button', { class: 'small danger', onclick: () => {
            if (confirm('Delete ' + p.name + ' entirely?')) guard('Deleting', async () => { DB.participants = (await call('admin_deleteParticipant', { code: p.code })).participants; renderParticipants(); });
          } }, 'Delete')))));
    });
    el.append(h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Code', 'Condition', 'Photo', 'Status', ''].map((t) => h('th', {}, t)))), tbody));
  }

  /* ---------------- feed editor ---------------- */
  const userOpts = () => DB.users.map((u) => [String(u.id), u.fullName + ' / ' + u.pseudonym]);

  function renderFeed() {
    const el = $('tab-feed'); el.textContent = '';
    const locked = isTrue(DB.settings.feedLocked);
    el.append(h('h2', {}, 'Scripted feed'));
    el.append(h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('label', {}, h('input', { id: 'lock-cb', type: 'checkbox', checked: locked, onchange: (e) => {
          DB.settings.feedLocked = e.target.checked ? 'TRUE' : 'FALSE';
          guard('Saving lock', async () => { await saveSettings(); renderFeed(); });
        } }), ' Lock feed (prevents edits once data collection starts)'),
        h('span', { class: 'grow' }),
        h('button', { class: 'primary', onclick: () => guard('Saving feed', saveFeed) }, 'Save feed'),
        h('button', { onclick: () => { DB.posts.push({ id: uid('p'), order: DB.posts.length + 1, authorId: String(DB.users[0] ? DB.users[0].id : ''), type: 'neutral', text: '', imageUrl: '', likes: 0, minsAgo: 30, active: 'TRUE' }); renderFeed(); } }, '+ Add post')),
      h('div', { class: 'note' }, 'Every participant sees this exact feed in this order, in every condition. Colored borders mark the post type; participants never see the type. Like counts and times are fixed. Put images in the repo "images" folder and enter a path like images/footprint.jpg.')));

    DB.posts.forEach((p, i) => el.append(postEditor(p, i)));
    if (locked) el.querySelectorAll('input,select,textarea,button').forEach((x) => { if (x.id !== 'lock-cb' && !x.closest('.counts')) x.disabled = true; });
  }

  function postEditor(p, i) {
    const card = h('div', { class: 'card post-ed type-' + p.type });
    const move = (d) => { const j = i + d; if (j < 0 || j >= DB.posts.length) return; const t = DB.posts[i]; DB.posts[i] = DB.posts[j]; DB.posts[j] = t; renderFeed(); };
    card.append(h('div', { class: 'row' },
      h('b', {}, '#' + (i + 1)),
      h('label', {}, h('input', { type: 'checkbox', checked: isTrue(p.active), onchange: (e) => { p.active = e.target.checked ? 'TRUE' : 'FALSE'; } }), ' Shown'),
      sel(userOpts(), String(p.authorId), (v) => { p.authorId = v; }),
      sel(TYPES, p.type, (v) => { p.type = v; renderFeed(); }),
      h('label', {}, 'Mins ago ', h('input', { type: 'number', min: '0', style: 'width:70px', value: p.minsAgo, oninput: (e) => { p.minsAgo = Number(e.target.value) || 0; } })),
      h('label', {}, 'Likes ', h('input', { type: 'number', min: '0', style: 'width:70px', value: p.likes, oninput: (e) => { p.likes = Number(e.target.value) || 0; } })),
      h('span', { class: 'grow' }),
      h('button', { class: 'small', onclick: () => move(-1) }, '↑'), h('button', { class: 'small', onclick: () => move(1) }, '↓'),
      h('button', { class: 'small danger', onclick: () => {
        if (!confirm('Delete this post and its comments?')) return;
        DB.comments = DB.comments.filter((c) => String(c.postId) !== String(p.id)); DB.posts.splice(i, 1); renderFeed();
      } }, 'Delete')));
    card.append(h('textarea', { rows: '2', placeholder: 'Post text', value: p.text, oninput: (e) => { p.text = e.target.value; } }));
    card.append(h('div', { class: 'row' }, h('input', { type: 'text', class: 'grow', placeholder: 'Image path or URL (optional), e.g. images/footprint.jpg', value: p.imageUrl, oninput: (e) => { p.imageUrl = e.target.value; } })));
    card.append(h('h3', {}, 'Comments'));
    DB.comments.forEach((c) => {
      if (String(c.postId) !== String(p.id)) return;
      card.append(h('div', { class: 'cm' },
        sel(userOpts(), String(c.authorId), (v) => { c.authorId = v; }),
        h('input', { type: 'text', class: 'grow', value: c.text, placeholder: 'Comment text', oninput: (e) => { c.text = e.target.value; } }),
        h('label', {}, '👍 ', h('input', { type: 'number', min: '0', style: 'width:64px', value: c.likes, oninput: (e) => { c.likes = Number(e.target.value) || 0; } })),
        h('button', { class: 'small danger', onclick: () => { DB.comments.splice(DB.comments.indexOf(c), 1); renderFeed(); } }, '✕')));
    });
    card.append(h('button', { class: 'small', onclick: () => {
      DB.comments.push({ id: uid('c'), postId: p.id, authorId: String(DB.users[0] ? DB.users[0].id : ''), text: '', likes: 0, order: 0 }); renderFeed();
    } }, '+ Add comment'));
    return card;
  }

  async function saveFeed() {
    DB.posts.forEach((p, i) => { p.order = i + 1; });
    const counter = {};
    DB.comments.forEach((c) => { const k = String(c.postId); counter[k] = (counter[k] || 0) + 1; c.order = counter[k]; });
    await call('admin_saveTable', { table: 'Posts', rows: DB.posts.map((p) => Object.assign({}, p, { active: isTrue(p.active) ? 'TRUE' : 'FALSE' })) });
    await call('admin_saveTable', { table: 'Comments', rows: DB.comments.filter((c) => DB.posts.some((p) => String(p.id) === String(c.postId))) });
  }

  /* ---------------- fake users ---------------- */
  function renderUsers() {
    const el = $('tab-users'); el.textContent = '';
    const locked = isTrue(DB.settings.feedLocked);
    el.append(h('h2', {}, 'Fake users'));
    el.append(h('div', { class: 'note' }, 'Each fake user has three versions of their identity, one per condition. Participants see only the version matching their group: full name (not anonymous), pseudonym (use the same two formats you give participants), or "Anonymous User #number".'));
    const tbody = h('tbody', {});
    DB.users.forEach((u, i) => {
      tbody.append(h('tr', {},
        h('td', { class: 'mono' }, String(u.id)),
        h('td', {}, h('input', { type: 'text', value: u.fullName, oninput: (e) => { u.fullName = e.target.value; } })),
        h('td', {}, h('input', { type: 'text', value: u.pseudonym, maxlength: '30', oninput: (e) => { u.pseudonym = e.target.value; } })),
        h('td', {}, h('input', { type: 'text', value: String(u.anonNum), style: 'width:80px', oninput: (e) => { u.anonNum = e.target.value; } })),
        h('td', {}, h('input', { type: 'text', value: u.color, style: 'width:90px', oninput: (e) => { u.color = e.target.value; } })),
        h('td', {}, h('button', { class: 'small danger', onclick: () => {
          if (DB.posts.some((p) => String(p.authorId) === String(u.id)) || DB.comments.some((c) => String(c.authorId) === String(u.id))) { alert('This user still has posts or comments. Reassign or delete those first.'); return; }
          DB.users.splice(i, 1); renderUsers();
        } }, '✕'))));
    });
    el.append(h('table', {}, h('thead', {}, h('tr', {}, ['ID', 'Full name', 'Pseudonym', 'Anon #', 'Avatar color', ''].map((t) => h('th', {}, t)))), tbody));
    el.append(h('div', { class: 'row' },
      h('button', { onclick: () => { DB.users.push({ id: uid('u'), fullName: '', pseudonym: '', anonNum: String(1000 + Math.floor(Math.random() * 9000)), color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') }); renderUsers(); } }, '+ Add user'),
      h('button', { class: 'primary', onclick: () => guard('Saving users', () => call('admin_saveTable', { table: 'Users', rows: DB.users })) }, 'Save users')));
    if (locked) el.querySelectorAll('input,button').forEach((x) => { x.disabled = true; });
  }

  /* ---------------- text & settings ---------------- */
  const TEXT_FIELDS = [
    ['platformName', 'Platform name', 1],
    ['introText', 'Intro screen text (shown before the profile step)', 4],
    ['instructionNamed', 'Profile instructions: NOT ANONYMOUS group', 4],
    ['instructionPseudo', 'Profile instructions: PSEUDONYM group', 7],
    ['instructionAnon', 'Profile instructions: ANONYMOUS group', 4],
    ['debriefText', 'Debrief text (paste your IRB-approved version)', 9],
    ['withdrawText', 'Data-withdrawal text (shown under the debrief)', 3]
  ];
  async function saveSettings() {
    await call('admin_saveTable', { table: 'Settings', rows: Object.keys(DB.settings).map((k) => ({ key: k, value: DB.settings[k] })) });
  }
  function renderText() {
    const el = $('tab-text'); el.textContent = '';
    el.append(h('h2', {}, 'Text & settings'));
    TEXT_FIELDS.forEach((f) => {
      const input = f[2] === 1 ? h('input', { type: 'text', value: DB.settings[f[0]] || '', oninput: (e) => { DB.settings[f[0]] = e.target.value; } })
        : h('textarea', { rows: String(f[2]), value: DB.settings[f[0]] || '', oninput: (e) => { DB.settings[f[0]] = e.target.value; } });
      el.append(h('div', { class: 'card' }, h('h3', {}, f[1]), input));
    });
    el.append(h('button', { class: 'primary', onclick: () => guard('Saving text', saveSettings) }, 'Save text'));
  }

  /* ---------------- data ---------------- */
  const EVENT_TYPES = ['like', 'unlike', 'comment', 'comment_like', 'comment_unlike', 'repost', 'report_post', 'report_comment', 'block'];
  function summarize() {
    const by = {};
    DB.participants.forEach((p) => { by[p.code] = { code: p.code, condition: p.condition, status: p.status, session_ms: 0, dwell_total_ms: 0 }; });
    DB.events.forEach((e) => {
      const r = by[e.code] || (by[e.code] = { code: e.code, condition: e.condition, status: '', session_ms: 0, dwell_total_ms: 0 });
      const pt = e.postType || 'none';
      r.session_ms = Math.max(r.session_ms, Number(e.msSinceStart) || 0);
      if (e.type === 'post_dwell') { r.dwell_total_ms += Number(e.dwellMs) || 0; r['dwell_ms__' + pt] = (r['dwell_ms__' + pt] || 0) + (Number(e.dwellMs) || 0); }
      if (EVENT_TYPES.indexOf(e.type) >= 0) {
        r[e.type + '__total'] = (r[e.type + '__total'] || 0) + 1;
        r[e.type + '__' + pt] = (r[e.type + '__' + pt] || 0) + 1;
      }
    });
    return Object.keys(by).map((k) => by[k]);
  }
  function renderData() {
    const el = $('tab-data'); el.textContent = '';
    el.append(h('h2', {}, 'Data'));
    el.append(h('div', { class: 'card' },
      h('button', { class: 'primary', onclick: () => guard('Loading events', async () => { DB.events = (await call('admin_events')).events; renderData(); }) }, DB.events ? 'Reload events' : 'Load events'),
      h('div', { class: 'note' }, 'Exports contain participant codes only (no names or photos). The key linking codes to names is in the Participants tab.')));
    if (!DB.events) return;
    const rows = summarize();
    el.append(h('div', { class: 'card' }, h('b', {}, DB.events.length + ' events from ' + rows.filter((r) => r.session_ms > 0).length + ' participants'),
      h('div', { class: 'row' },
        h('button', { onclick: () => {
          const cols = ['ts', 'code', 'condition', 'type', 'postId', 'postType', 'targetId', 'text', 'msSinceStart', 'dwellMs'];
          downloadCsv('events.csv', [cols].concat(DB.events.map((e) => cols.map((c) => e[c]))));
        } }, 'Download events (CSV)'),
        h('button', { onclick: () => {
          const keys = {}; rows.forEach((r) => Object.keys(r).forEach((k) => { keys[k] = 1; }));
          const fixed = ['code', 'condition', 'status', 'session_ms', 'dwell_total_ms'];
          const rest = Object.keys(keys).filter((k) => fixed.indexOf(k) < 0).sort();
          const cols = fixed.concat(rest);
          downloadCsv('participant_summary.csv', [cols].concat(rows.map((r) => cols.map((c) => (r[c] === undefined ? (c.indexOf('__') > 0 || c.indexOf('dwell') === 0 ? 0 : '') : r[c])))));
        } }, 'Download per-participant summary (CSV)'))));
    const show = ['code', 'condition', 'status', 'like__total', 'comment__total', 'repost__total', 'report_post__total', 'report_comment__total', 'block__total', 'dwell_total_ms'];
    el.append(h('table', {}, h('thead', {}, h('tr', {}, show.map((c) => h('th', {}, c.replace('__total', ''))))),
      h('tbody', {}, rows.map((r) => h('tr', {}, show.map((c) => h('td', {}, String(r[c] === undefined ? (c.indexOf('__') > 0 || c === 'dwell_total_ms' ? 0 : '') : r[c]))))))));
  }

  /* ---------------- preview ---------------- */
  function renderPreview() {
    const el = $('tab-preview'); el.textContent = '';
    el.append(h('h2', {}, 'Preview'));
    el.append(h('div', { class: 'note' }, 'Opens the participant experience in a new tab for each condition. Previews do not record any data.'));
    el.append(h('div', { class: 'row' }, [['named', 'Not anonymous'], ['pseudonym', 'Pseudonym'], ['anonymous', 'Anonymous']].map((c) =>
      h('button', { class: 'primary', onclick: () => window.open(studyBase() + '?preview=' + c[0], '_blank') }, 'Preview: ' + c[1]))));
  }
})();
