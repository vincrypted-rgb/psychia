(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const preview = params.get('preview');           // researcher preview: no logging
  let code = (params.get('code') || '').trim().toUpperCase();

  let FEED = null, cond = '', ME = {}, userById = {};
  let S = { liked: {}, cliked: {}, blocked: {}, reposted: {}, reported: {}, mine: {} };
  const t0 = performance.now();
  let queue = [], flushing = false, finished = false;

  /* ---------------- utilities ---------------- */
  const SCREENS = ['code', 'message', 'intro', 'profile', 'feed', 'debrief'];
  function show(name) {
    SCREENS.forEach((s) => $('screen-' + s).classList.toggle('hidden', s !== name));
    window.scrollTo(0, 0);
  }
  function showMessage(title, body) {
    $('message-title').textContent = title;
    $('message-body').textContent = body;
    show('message');
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  function ago(m) {
    if (m < 1) return 'Just now';
    if (m < 60) return m + 'm';
    if (m < 1440) return Math.floor(m / 60) + 'h';
    return Math.floor(m / 1440) + 'd';
  }
  function modal(title, bodyNodes, buttons) {
    const root = $('modal-root');
    const close = () => { root.textContent = ''; };
    const actions = h('div', { class: 'modal-actions' },
      buttons.map((b) => h('button', { class: b.cls || 'secondary', onclick: () => { if (b.fn) b.fn(close); else close(); } }, b.label)));
    root.textContent = '';
    root.append(h('div', { class: 'modal-bg', onclick: (e) => { if (e.target.classList.contains('modal-bg')) close(); } },
      h('div', { class: 'modal' }, h('h2', {}, title), bodyNodes, actions)));
    return close;
  }

  /* ---------------- persistence of local UI state ---------------- */
  const stateKey = () => 'circle_state_' + code;
  function saveState() { if (preview) return; try { localStorage.setItem(stateKey(), JSON.stringify(S)); } catch (e) {} }
  function loadState() {
    if (preview) return;
    try { const v = JSON.parse(localStorage.getItem(stateKey())); if (v) S = Object.assign(S, v); } catch (e) {}
  }

  /* ---------------- logging ---------------- */
  function log(type, o) {
    if (preview) return;
    o = o || {};
    queue.push({
      ts: new Date().toISOString(), type: type,
      postId: o.postId || '', targetId: o.targetId || '', text: o.text || '',
      msSinceStart: Math.round(performance.now() - t0),
      dwellMs: o.dwellMs
    });
  }
  async function flush() {
    if (preview || flushing || !queue.length) return;
    flushing = true;
    const batch = queue.splice(0, 300);
    try {
      const r = await api.post({ action: 'events', code: code, events: batch });
      if (r.error) throw new Error(r.error);
    } catch (e) { queue.unshift.apply(queue, batch); }
    flushing = false;
  }
  setInterval(flush, 8000);

  /* ---------------- dwell time per post ---------------- */
  const dwell = {};          // postId -> {total, since, seen}
  const visible = new Set();
  let io = null;
  function dwellOf(id) { return dwell[id] || (dwell[id] = { total: 0, since: null, seen: false }); }
  function pauseDwell() {
    const now = performance.now();
    Object.keys(dwell).forEach((id) => {
      const d = dwell[id];
      if (d.since !== null) { d.total += now - d.since; d.since = null; }
    });
  }
  function resumeDwell() {
    const now = performance.now();
    visible.forEach((id) => { const d = dwellOf(id); if (d.since === null) d.since = now; });
  }
  function setupObserver() {
    if (io) io.disconnect();
    visible.clear();
    io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const id = en.target.dataset.post;
        const d = dwellOf(id);
        const big = en.isIntersecting && (en.intersectionRatio >= 0.5 || en.intersectionRect.height >= window.innerHeight * 0.5);
        if (big) {
          visible.add(id);
          if (!document.hidden && d.since === null) d.since = performance.now();
          if (!d.seen) { d.seen = true; log('post_view', { postId: id }); }
        } else {
          visible.delete(id);
          if (d.since !== null) { d.total += performance.now() - d.since; d.since = null; }
        }
      });
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  }
  document.addEventListener('visibilitychange', () => { document.hidden ? pauseDwell() : resumeDwell(); });
  function logDwell() {
    pauseDwell();
    Object.keys(dwell).forEach((id) => { if (dwell[id].seen) log('post_dwell', { postId: id, dwellMs: Math.round(dwell[id].total) }); });
  }
  window.addEventListener('pagehide', () => {
    if (preview || finished || !FEED) return;
    logDwell();
    while (queue.length) api.beacon({ action: 'events', code: code, events: queue.splice(0, 100) });
  });

  /* ---------------- identity rendering ---------------- */
  function silhouette() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', '40'); bg.setAttribute('height', '40'); bg.setAttribute('fill', '#b0b3b8');
    const head = document.createElementNS(NS, 'circle');
    head.setAttribute('cx', '20'); head.setAttribute('cy', '15'); head.setAttribute('r', '7'); head.setAttribute('fill', '#fff');
    const body = document.createElementNS(NS, 'path');
    body.setAttribute('d', 'M6 40c0-9 6-14 14-14s14 5 14 14z'); body.setAttribute('fill', '#fff');
    svg.append(bg, head, body);
    return svg;
  }
  function avatar(size, label, color, photo) {
    const a = h('div', { class: 'avatar s' + size });
    if (cond === 'anonymous') { a.append(silhouette()); return a; }
    if (photo) { a.append(h('img', { src: photo, alt: '' })); return a; }
    a.style.background = color || '#888';
    a.textContent = (label || '?').trim().charAt(0).toUpperCase();
    return a;
  }
  function nameOfUser(u) {
    if (cond === 'named') return u.fullName;
    if (cond === 'pseudonym') return u.pseudonym;
    return 'Anonymous User #' + u.anonNum;
  }
  function myName() {
    if (cond === 'named') return ME.name;
    if (cond === 'pseudonym') return ME.pseudonym;
    return 'Anonymous User #' + ME.anonNum;
  }
  function myAvatar(size) { return avatar(size, myName(), '#1877f2', cond === 'named' ? ME.photo : ''); }

  /* ---------------- screens: code → intro → profile ---------------- */
  const ERR = {
    invalid_code: 'That code was not recognized. Please check it and try again.',
    withdrawn: 'This participant code is no longer active.',
    not_assigned: 'This session is not ready yet. Please ask the researcher.'
  };

  async function load() {
    if (!api.ready()) { $('code-error').textContent = 'The study server is not configured yet.'; $('code-error').classList.remove('hidden'); return; }
    $('code-error').classList.add('hidden');
    try {
      const data = preview
        ? await api.post({ action: 'admin_preview', pass: localStorage.getItem('circle_admin_pass') || '', condition: preview })
        : await api.get({ action: 'feed', code: code });
      if (data.error) {
        const msg = ERR[data.error] || ('Could not load the study (' + data.error + ').');
        if (!preview && $('screen-code').classList.contains('hidden') === false) { $('code-error').textContent = msg; $('code-error').classList.remove('hidden'); }
        else showMessage('Unable to continue', msg);
        return;
      }
      FEED = data; ME = data.participant; cond = ME.condition;
      userById = {}; data.users.forEach((u) => { userById[u.id] = u; });
      document.title = data.settings.platformName || 'Circle';
      $('logo').textContent = data.settings.platformName || 'Circle';
      loadState();
      if (ME.status === 'completed') { showMessage('Already completed', 'You have already completed this study. Thank you!'); return; }
      if (preview) { showIntro(); return; }
      if (ME.status === 'started' && profileReady()) enterFeed(); else showIntro();
    } catch (e) {
      $('code-error').textContent = 'Could not reach the study server. Check your connection and try again.';
      $('code-error').classList.remove('hidden');
    }
  }
  const profileReady = () => cond !== 'pseudonym' || !!ME.pseudonym;

  function showIntro() {
    $('intro-text').textContent = FEED.settings.introText || '';
    $('intro-check').checked = false; $('intro-btn').disabled = true;
    show('intro');
  }
  $('intro-check').addEventListener('change', () => { $('intro-btn').disabled = !$('intro-check').checked; });
  $('intro-btn').addEventListener('click', async () => {
    if (!preview) { try { await api.post({ action: 'start', code: code }); } catch (e) {} }
    showProfile();
  });

  function showProfile() {
    const key = cond === 'named' ? 'instructionNamed' : cond === 'pseudonym' ? 'instructionPseudo' : 'instructionAnon';
    $('profile-text').textContent = FEED.settings[key] || '';
    const body = $('profile-body'); body.textContent = '';
    if (cond === 'pseudonym' && !ME.pseudonym) { body.append(pseudonymForm()); show('profile'); return; }
    body.append(
      h('div', { class: 'profile-card' }, myAvatar(96), h('div', { class: 'big' }, myName())),
      h('button', { class: 'primary', onclick: enterFeed }, 'Continue to Circle')
    );
    show('profile');
  }

  function validPseudo(opt, v) {
    v = v.trim();
    if (opt === 'A') return /^[A-Za-z]{2}\d{1,4}$/.test(v);
    return v.length >= 3 && v.length <= 30 && /\s/.test(v) && /[A-Za-z]/.test(v);
  }
  function pseudonymForm() {
    let opt = 'A';
    const input = h('input', { type: 'text', maxlength: '30', placeholder: 'e.g. MC1204', autocomplete: 'off' });
    const hint = h('div', { class: 'error' }, '');
    const btn = h('button', { class: 'primary', disabled: true }, 'Confirm (cannot be changed)');
    function refresh() {
      const ok = validPseudo(opt, input.value);
      btn.disabled = !ok;
      hint.textContent = input.value && !ok
        ? (opt === 'A' ? 'Use two letters followed by 1 to 4 digits.' : 'Use your first name and an interest (3–30 characters).') : '';
    }
    const radio = (v, label) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'popt', value: v, checked: v === 'A',
        onchange: () => { opt = v; input.placeholder = v === 'A' ? 'e.g. MC1204' : 'e.g. Maya hiking'; refresh(); } }), ' ' + label);
    input.addEventListener('input', refresh);
    btn.addEventListener('click', async () => {
      const v = input.value.trim();
      if (!validPseudo(opt, v)) return;
      const close = modal('Confirm your username',
        h('p', {}, 'You will appear as "' + v + '". This cannot be changed.'),
        [{ label: 'Go back' }, { label: 'Confirm', cls: 'primary', fn: async (c) => {
          if (preview) { ME.pseudonym = v; c(); enterFeed(); return; }
          try {
            const r = await api.post({ action: 'setProfile', code: code, pseudonym: v });
            if (r.error) { c(); toast('Could not save: ' + r.error); return; }
            ME.pseudonym = r.pseudonym; log('profile_set', { text: opt }); c(); enterFeed();
          } catch (e) { c(); toast('Connection problem, please try again.'); }
        } }]);
    });
    return h('div', {}, radio('A', 'Initials + number'), radio('B', 'First name + interest'), input, hint, btn);
  }

  /* ---------------- feed ---------------- */
  function enterFeed() {
    const chip = $('me-chip'); chip.textContent = '';
    chip.append(myAvatar(32), h('span', {}, myName())); chip.classList.remove('hidden');
    log('feed_enter', { text: cond });
    show('feed');
    setupObserver();
    renderFeed();
  }

  function menu(items) {
    const m = h('div', { class: 'menu hidden' }, items.map((it) => h('button', { onclick: (e) => { e.stopPropagation(); m.classList.add('hidden'); it.fn(); } }, it.label)));
    const b = h('button', { class: 'dots', 'aria-label': 'More options', onclick: (e) => {
      e.stopPropagation();
      document.querySelectorAll('.menu').forEach((x) => { if (x !== m) x.classList.add('hidden'); });
      m.classList.toggle('hidden');
    } }, '⋯');
    return h('span', { style: 'position:relative' }, b, m);
  }
  document.addEventListener('click', () => document.querySelectorAll('.menu').forEach((x) => x.classList.add('hidden')));

  const REASONS = ['Harassment or bullying', 'Hate or discrimination', 'Threats or violence', 'Spam or scam', 'False information', 'Something else'];
  function reportFlow(opts) {
    const key = opts.commentId ? 'c:' + opts.commentId : 'p:' + opts.postId;
    if (S.reported[key]) { toast('You already reported this.'); return; }
    let reason = '';
    const details = h('textarea', { rows: '2', maxlength: '500', placeholder: 'Additional details (optional)' });
    const body = h('div', {}, REASONS.map((r) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'reason', onchange: () => { reason = r; } }), ' ' + r)), details);
    modal('Report ' + (opts.commentId ? 'comment' : 'post'), body, [
      { label: 'Cancel' },
      { label: 'Submit report', cls: 'primary', fn: (close) => {
        if (!reason) { toast('Please choose a reason.'); return; }
        log(opts.commentId ? 'report_comment' : 'report_post', {
          postId: opts.postId, targetId: opts.commentId || opts.authorId,
          text: reason + (details.value.trim() ? ' | ' + details.value.trim() : '')
        });
        S.reported[key] = 1; saveState(); close(); toast('Thanks, your report was submitted.');
      } }]);
  }
  function blockFlow(authorId, postId, from) {
    const u = userById[authorId];
    modal('Block ' + nameOfUser(u) + '?', h('p', {}, 'Their posts and comments will be hidden from your feed.'), [
      { label: 'Cancel' },
      { label: 'Block', cls: 'danger', fn: (close) => {
        log('block', { postId: postId, targetId: authorId, text: from });
        S.blocked[authorId] = 1; saveState(); close();
        const y = window.scrollY; renderFeed(); window.scrollTo(0, y); toast('User blocked.');
      } }]);
  }
  function repostFlow(p, btn) {
    const note = h('textarea', { rows: '3', maxlength: '500', placeholder: 'Add a note (optional)' });
    modal('Repost to your profile', note, [
      { label: 'Cancel' },
      { label: 'Repost', cls: 'primary', fn: (close) => {
        log('repost', { postId: p.id, targetId: p.authorId, text: note.value.trim() });
        S.reposted[p.id] = 1; saveState(); close();
        btn.textContent = '🔁 Reposted'; btn.classList.add('on'); btn.disabled = true; toast('Reposted.');
      } }]);
  }

  function commentRow(c, p) {
    const u = userById[c.authorId];
    const likeBtn = h('button', { class: S.cliked[c.id] ? 'on' : '' }, 'Like');
    const count = h('span', {}, '');
    function refresh() { const n = c.likes + (S.cliked[c.id] ? 1 : 0); count.textContent = n ? '👍 ' + n : ''; likeBtn.classList.toggle('on', !!S.cliked[c.id]); }
    likeBtn.addEventListener('click', () => {
      S.cliked[c.id] = S.cliked[c.id] ? 0 : 1; saveState();
      log(S.cliked[c.id] ? 'comment_like' : 'comment_unlike', { postId: p.id, targetId: c.id });
      refresh();
    });
    refresh();
    return h('div', { class: 'comment', 'data-author': c.authorId },
      avatar(32, nameOfUser(u), u.color),
      h('div', { class: 'bubble-wrap' },
        h('div', { class: 'bubble' }, h('b', {}, nameOfUser(u)), h('span', {}, c.text)),
        h('div', { class: 'comment-tools' }, likeBtn, count)),
      menu([
        { label: 'Report comment', fn: () => reportFlow({ postId: p.id, commentId: c.id, authorId: c.authorId }) },
        { label: 'Block ' + nameOfUser(u), fn: () => blockFlow(c.authorId, p.id, 'from_comment') }
      ]));
  }
  function myCommentRow(text) {
    return h('div', { class: 'comment fade-in' }, myAvatar(32),
      h('div', { class: 'bubble-wrap' }, h('div', { class: 'bubble' }, h('b', {}, myName()), h('span', {}, text))));
  }

  function postCard(p) {
    const u = userById[p.authorId];
    const card = h('article', { class: 'card post', 'data-post': p.id, 'data-author': p.authorId });
    card.append(h('div', { class: 'post-head' },
      avatar(44, nameOfUser(u), u.color),
      h('div', { class: 'post-meta' }, h('div', { class: 'post-name' }, nameOfUser(u)), h('div', { class: 'post-time' }, ago(p.minsAgo))),
      menu([
        { label: 'Report post', fn: () => reportFlow({ postId: p.id, authorId: p.authorId }) },
        { label: 'Block ' + nameOfUser(u), fn: () => blockFlow(p.authorId, p.id, 'from_post') }
      ])));
    card.append(h('div', { class: 'post-body' }, p.text));
    if (p.imageUrl) card.append(h('img', { class: 'post-img', src: p.imageUrl, alt: '' }));

    const likeStat = h('span', {}), commentStat = h('span', {});
    const comments = h('div', { class: 'comments' });
    p.comments.filter((c) => !S.blocked[c.authorId]).forEach((c) => comments.append(commentRow(c, p)));
    (S.mine[p.id] || []).forEach((t) => comments.append(myCommentRow(t)));
    function refresh() {
      const n = p.likes + (S.liked[p.id] ? 1 : 0);
      likeStat.textContent = n ? '👍 ' + n : '';
      const cn = p.comments.filter((c) => !S.blocked[c.authorId]).length + (S.mine[p.id] || []).length;
      commentStat.textContent = cn ? cn + (cn === 1 ? ' comment' : ' comments') : '';
    }
    card.append(h('div', { class: 'stats' }, likeStat, commentStat));

    const likeBtn = h('button', { class: S.liked[p.id] ? 'on' : '' }, '👍 Like');
    likeBtn.addEventListener('click', () => {
      S.liked[p.id] = S.liked[p.id] ? 0 : 1; saveState();
      likeBtn.classList.toggle('on', !!S.liked[p.id]);
      log(S.liked[p.id] ? 'like' : 'unlike', { postId: p.id, targetId: p.authorId });
      refresh();
    });
    const input = h('input', { type: 'text', placeholder: 'Write a comment…', maxlength: '500' });
    const commentBtn = h('button', {}, '💬 Comment');
    commentBtn.addEventListener('click', () => input.focus());
    const repostBtn = h('button', { class: S.reposted[p.id] ? 'on' : '', disabled: !!S.reposted[p.id] }, S.reposted[p.id] ? '🔁 Reposted' : '🔁 Repost');
    repostBtn.addEventListener('click', () => repostFlow(p, repostBtn));
    card.append(h('div', { class: 'actions' }, likeBtn, commentBtn, repostBtn), comments);

    const send = h('button', { class: 'secondary' }, 'Send');
    function submit() {
      const v = input.value.trim();
      if (!v) return;
      comments.append(myCommentRow(v));
      (S.mine[p.id] = S.mine[p.id] || []).push(v); saveState();
      log('comment', { postId: p.id, targetId: p.authorId, text: v });
      input.value = ''; refresh();
    }
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    card.append(h('div', { class: 'comment-form' }, input, send));
    refresh();
    return card;
  }

  function renderFeed() {
    pauseDwell();
    setupObserver();
    const box = $('posts'); box.textContent = '';
    FEED.posts.forEach((p) => {
      if (S.blocked[p.authorId]) return;
      const c = postCard(p);
      box.append(c); io.observe(c);
    });
  }

  /* ---------------- finish & debrief ---------------- */
  $('finish-btn').addEventListener('click', () => {
    modal('Finish?', h('p', {}, 'Are you sure you are finished? You will not be able to return to the feed.'), [
      { label: 'Keep browsing' },
      { label: 'Yes, finish', cls: 'primary', fn: async (close) => { close(); await finish(); } }]);
  });
  async function finish() {
    logDwell(); log('finish');
    finished = true;
    if (!preview) {
      for (let i = 0; i < 4 && queue.length; i++) await flush();
      try { await api.post({ action: 'complete', code: code }); } catch (e) {}
    }
    $('debrief-text').textContent = FEED.settings.debriefText || '';
    $('withdraw-text').textContent = FEED.settings.withdrawText || '';
    $('me-chip').classList.add('hidden');
    show('debrief');
  }
  $('withdraw-btn').addEventListener('click', () => {
    modal('Remove your data?', h('p', {}, 'This deletes everything recorded during your session. This cannot be undone.'), [
      { label: 'Cancel' },
      { label: 'Remove my data', cls: 'danger', fn: async (close) => {
        try {
          if (!preview) { const r = await api.post({ action: 'withdraw', code: code }); if (r.error) throw new Error(r.error); }
          try { localStorage.removeItem(stateKey()); } catch (e) {}
          $('withdraw-btn').classList.add('hidden'); $('withdraw-done').classList.remove('hidden'); close();
        } catch (e) { close(); toast('Could not remove data. Please contact the researcher.'); }
      } }]);
  });

  /* ---------------- boot ---------------- */
  $('code-btn').addEventListener('click', () => { code = $('code-input').value.trim().toUpperCase(); if (code) load(); });
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('code-btn').click(); });
  if (preview) load();
  else if (code) load();
  else show('code');
})();
