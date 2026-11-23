/** @OnlyCurrentDoc */
/**
 * CIRCLE STUDY BACKEND (Google Apps Script, bound to a Google Sheet)
 *
 * Stores: Settings, Users (fake users), Posts, Comments (scripted feed),
 *         Participants (name, condition, photo, status), Events (behavior log).
 * Participants can only ever fetch THEIR OWN record plus the shared scripted feed.
 * Admin actions require the ADMIN_PASS script property.
 */

const TABLES = {
  Settings:     ['key', 'value'],
  Users:        ['id', 'fullName', 'pseudonym', 'anonNum', 'color'],
  Posts:        ['id', 'order', 'authorId', 'type', 'text', 'imageUrl', 'likes', 'minsAgo', 'active'],
  Comments:     ['id', 'postId', 'authorId', 'text', 'likes', 'order'],
  Participants: ['code', 'name', 'condition', 'photo', 'anonNum', 'pseudonym', 'status', 'createdAt', 'startedAt', 'completedAt'],
  Events:       ['ts', 'code', 'condition', 'type', 'postId', 'postType', 'targetId', 'text', 'msSinceStart', 'dwellMs']
};
const CONDITIONS = ['named', 'pseudonym', 'anonymous'];
const DEFAULT_PASS = 'CHANGE_ME';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  let s = ss_().getSheetByName(name);
  if (!s) {
    s = ss_().insertSheet(name);
    s.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]);
    s.setFrozenRows(1);
  }
  return s;
}

// Stop cells that start with = + - @ from being treated as formulas.
function safe_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function read_(name) {
  const v = sheet_(name).getDataRange().getValues();
  const h = TABLES[name];
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const o = {};
    h.forEach((k, j) => { o[k] = v[i][j]; });
    if (h.some(k => o[k] !== '' && o[k] !== null)) out.push(o);
  }
  return out;
}

function write_(name, rows) {
  const s = sheet_(name), h = TABLES[name];
  const last = s.getLastRow();
  if (last > 1) s.getRange(2, 1, last - 1, h.length).clearContent();
  if (rows.length) {
    s.getRange(2, 1, rows.length, h.length)
      .setValues(rows.map(r => h.map(k => safe_(r[k] === undefined || r[k] === null ? '' : r[k]))));
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

const str_ = v => (v === undefined || v === null) ? '' : String(v);
const isTrue_ = v => String(v).toUpperCase() === 'TRUE';

/* ------------------------------------------------------------------ */
/* HTTP entry points                                                   */
/* ------------------------------------------------------------------ */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === 'feed') return json_(feed_(p.code));
    return json_({ ok: true });
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    const fn = ROUTES[b.action];
    if (!fn) return json_({ error: 'unknown_action' });
    return json_(fn(b));
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

/* ------------------------------------------------------------------ */
/* Participant side                                                    */
/* ------------------------------------------------------------------ */
const normCode_ = c => str_(c).trim().toUpperCase();
const getP_ = code => read_('Participants').find(r => String(r.code) === normCode_(code));

function settingsObj_() {
  const o = {};
  read_('Settings').forEach(r => { o[r.key] = str_(r.value); });
  return o;
}

function buildFeed_(p) {
  const comments = read_('Comments');
  const users = read_('Users').map(u => ({
    id: String(u.id), fullName: str_(u.fullName), pseudonym: str_(u.pseudonym),
    anonNum: String(u.anonNum), color: str_(u.color) || '#888888'
  }));
  const posts = read_('Posts')
    .filter(x => isTrue_(x.active))
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map(x => ({
      id: String(x.id), authorId: String(x.authorId), text: str_(x.text), imageUrl: str_(x.imageUrl),
      likes: Number(x.likes) || 0, minsAgo: Number(x.minsAgo) || 0,
      comments: comments.filter(c => String(c.postId) === String(x.id))
        .sort((a, b) => Number(a.order) - Number(b.order))
        .map(c => ({ id: String(c.id), authorId: String(c.authorId), text: str_(c.text), likes: Number(c.likes) || 0 }))
    }));
  const named = p.condition === 'named';
  return {
    participant: {
      condition: p.condition,
      name: named ? str_(p.name) : '',
      photo: named ? str_(p.photo) : '',
      pseudonym: str_(p.pseudonym),
      anonNum: String(p.anonNum),
      status: str_(p.status)
    },
    settings: settingsObj_(), users: users, posts: posts
  };
}

function feed_(code) {
  const p = getP_(code);
  if (!p) return { error: 'invalid_code' };
  if (p.status === 'withdrawn') return { error: 'withdrawn' };
  if (CONDITIONS.indexOf(p.condition) < 0) return { error: 'not_assigned' };
  return buildFeed_(p);
}

function updateP_(code, fields) {
  const s = sheet_('Participants'), h = TABLES.Participants;
  const v = s.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]) === normCode_(code)) {
      Object.keys(fields).forEach(k => {
        const j = h.indexOf(k);
        if (j >= 0) s.getRange(i + 1, j + 1, 1, 1).setValue(safe_(fields[k]));
      });
      return true;
    }
  }
  return false;
}

function validPseudo_(v) {
  v = str_(v).trim();
  return /^[A-Za-z]{2}\d{1,4}$/.test(v) || (v.length >= 3 && v.length <= 30 && /\s/.test(v) && /[A-Za-z]/.test(v));
}

function deleteEvents_(code) {
  const keep = read_('Events').filter(r => String(r.code) !== normCode_(code));
  write_('Events', keep);
}

const ROUTES = {
  start: function (b) {
    return withLock_(() => {
      const p = getP_(b.code);
      if (!p || p.status === 'withdrawn') return { error: 'invalid_code' };
      if (p.status === 'created' || p.status === '') {
        updateP_(b.code, { status: 'started', startedAt: new Date().toISOString() });
      }
      return { ok: true };
    });
  },

  setProfile: function (b) {
    return withLock_(() => {
      const p = getP_(b.code);
      if (!p || p.status === 'withdrawn') return { error: 'invalid_code' };
      if (p.condition !== 'pseudonym') return { error: 'not_pseudonym_condition' };
      if (str_(p.pseudonym)) return { error: 'already_set' };
      const v = str_(b.pseudonym).trim();
      if (!validPseudo_(v)) return { error: 'invalid_pseudonym' };
      updateP_(b.code, { pseudonym: v });
      return { ok: true, pseudonym: v };
    });
  },

  events: function (b) {
    return withLock_(() => {
      const p = getP_(b.code);
      if (!p || p.status === 'withdrawn') return { error: 'invalid_code' };
      const types = {};
      read_('Posts').forEach(x => { types[String(x.id)] = x.type; });
      const evs = (b.events || []).slice(0, 500);
      if (!evs.length) return { ok: true, n: 0 };
      const rows = evs.map(e => [
        safe_(str_(e.ts) || new Date().toISOString()), normCode_(b.code), p.condition,
        safe_(str_(e.type).slice(0, 40)), safe_(str_(e.postId).slice(0, 60)),
        safe_(str_(types[str_(e.postId)])), safe_(str_(e.targetId).slice(0, 60)),
        safe_(str_(e.text).slice(0, 2000)),
        e.msSinceStart === undefined ? '' : Number(e.msSinceStart) || 0,
        e.dwellMs === undefined ? '' : Number(e.dwellMs) || 0
      ]);
      const s = sheet_('Events');
      s.getRange(s.getLastRow() + 1, 1, rows.length, TABLES.Events.length).setValues(rows);
      return { ok: true, n: rows.length };
    });
  },

  complete: function (b) {
    return withLock_(() => {
      const p = getP_(b.code);
      if (!p || p.status === 'withdrawn') return { error: 'invalid_code' };
      updateP_(b.code, { status: 'completed', completedAt: new Date().toISOString() });
      return { ok: true };
    });
  },

  withdraw: function (b) {
    return withLock_(() => {
      const p = getP_(b.code);
      if (!p) return { error: 'invalid_code' };
      deleteEvents_(b.code);
      updateP_(b.code, { status: 'withdrawn', photo: '', pseudonym: '' });
      return { ok: true };
    });
  },

  /* ---------------- admin ---------------- */
  admin_get: function (b) {
    auth_(b);
    return {
      settings: read_('Settings'), users: read_('Users'), posts: read_('Posts'),
      comments: read_('Comments'), participants: read_('Participants')
    };
  },

  admin_events: function (b) {
    auth_(b);
    return { events: read_('Events'), posts: read_('Posts').map(p => ({ id: p.id, type: p.type })) };
  },

  admin_saveTable: function (b) {
    auth_(b);
    if (['Settings', 'Users', 'Posts', 'Comments'].indexOf(b.table) < 0) return { error: 'bad_table' };
    if (!Array.isArray(b.rows)) return { error: 'bad_rows' };
    return withLock_(() => {
      if (b.table !== 'Settings' && isTrue_(settingsObj_().feedLocked)) return { error: 'feed_locked' };
      write_(b.table, b.rows);
      return { ok: true };
    });
  },

  admin_upsertParticipants: function (b) {
    auth_(b);
    return withLock_(() => {
      const list = read_('Participants');
      const users = read_('Users');
      const usedNums = {};
      list.forEach(p => { usedNums[String(p.anonNum)] = 1; });
      users.forEach(u => { usedNums[String(u.anonNum)] = 1; });
      const usedCodes = {};
      list.forEach(p => { usedCodes[String(p.code)] = 1; });
      (b.rows || []).forEach(r => {
        const existing = r.code ? list.find(p => String(p.code) === normCode_(r.code)) : null;
        if (existing) {
          if (r.name !== undefined) existing.name = str_(r.name);
          if (r.condition !== undefined && (CONDITIONS.indexOf(r.condition) >= 0 || r.condition === '')) existing.condition = r.condition;
          if (r.photo !== undefined) existing.photo = str_(r.photo);
        } else if (str_(r.name).trim()) {
          let code; do { code = genCode_(); } while (usedCodes[code]);
          usedCodes[code] = 1;
          let num; do { num = String(1000 + Math.floor(Math.random() * 9000)); } while (usedNums[num]);
          usedNums[num] = 1;
          list.push({
            code: code, name: str_(r.name).trim(), condition: CONDITIONS.indexOf(r.condition) >= 0 ? r.condition : '',
            photo: str_(r.photo), anonNum: num, pseudonym: '', status: 'created',
            createdAt: new Date().toISOString(), startedAt: '', completedAt: ''
          });
        }
      });
      write_('Participants', list);
      return { participants: list };
    });
  },

  admin_randomAssign: function (b) {
    auth_(b);
    return withLock_(() => {
      const list = read_('Participants');
      const counts = { named: 0, pseudonym: 0, anonymous: 0 };
      list.forEach(p => { if (counts[p.condition] !== undefined) counts[p.condition]++; });
      const todo = list.filter(p => CONDITIONS.indexOf(p.condition) < 0);
      for (let i = todo.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = todo[i]; todo[i] = todo[j]; todo[j] = t;
      }
      todo.forEach(p => {
        const min = Math.min(counts.named, counts.pseudonym, counts.anonymous);
        const options = CONDITIONS.filter(c => counts[c] === min);
        const c = options[Math.floor(Math.random() * options.length)];
        p.condition = c; counts[c]++;
      });
      write_('Participants', list);
      return { participants: list, assigned: todo.length };
    });
  },

  admin_removeParticipantData: function (b) {
    auth_(b);
    return withLock_(() => {
      deleteEvents_(b.code);
      updateP_(b.code, { status: 'withdrawn', photo: '', pseudonym: '' });
      return { participants: read_('Participants') };
    });
  },

  admin_deleteParticipant: function (b) {
    auth_(b);
    return withLock_(() => {
      deleteEvents_(b.code);
      write_('Participants', read_('Participants').filter(p => String(p.code) !== normCode_(b.code)));
      return { participants: read_('Participants') };
    });
  },

  admin_deleteAllPhotos: function (b) {
    auth_(b);
    return withLock_(() => {
      const list = read_('Participants');
      list.forEach(p => { p.photo = ''; });
      write_('Participants', list);
      return { participants: list };
    });
  },

  admin_preview: function (b) {
    auth_(b);
    if (CONDITIONS.indexOf(b.condition) < 0) return { error: 'bad_condition' };
    return buildFeed_({
      condition: b.condition, name: 'Preview Participant', photo: '',
      pseudonym: 'Preview user', anonNum: '0000', status: 'preview'
    });
  }
};

function auth_(b) {
  const pass = PropertiesService.getScriptProperties().getProperty('ADMIN_PASS');
  if (!pass || pass === DEFAULT_PASS) throw new Error('admin_password_not_set');
  if (b.pass !== pass) throw new Error('unauthorized');
}

function genCode_() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  return s;
}

/* ------------------------------------------------------------------ */
/* One-time setup: run `setup` once from the Apps Script editor        */
/* ------------------------------------------------------------------ */
function setup() {
  Object.keys(TABLES).forEach(sheet_);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PASS')) props.setProperty('ADMIN_PASS', DEFAULT_PASS);
  if (read_('Settings').length === 0) write_('Settings', Object.keys(DEFAULT_SETTINGS).map(k => ({ key: k, value: DEFAULT_SETTINGS[k] })));
  if (read_('Users').length === 0) write_('Users', SEED_USERS);
  if (read_('Posts').length === 0) write_('Posts', SEED_POSTS);
  if (read_('Comments').length === 0) write_('Comments', SEED_COMMENTS);
  Logger.log('Setup done. Now set the ADMIN_PASS script property (Project Settings > Script properties) to a strong passphrase.');
}

const DEFAULT_SETTINGS = {
  platformName: 'Circle',
  feedLocked: 'FALSE',
  introText: 'Welcome to Circle, a campus community feed. Scroll through the feed and interact the way you normally would: like, comment, repost, report, or block. You can stop at any time.',
  instructionNamed: 'On Circle, your profile uses your name and photo from your study registration. These cannot be changed, and other users can see them.',
  instructionPseudo: 'Choose how you will appear to other users on Circle. Pick ONE format:\n\nA) Your first and last initial plus a number up to 4 digits (example: MC1204)\nB) Your first name and one of your interests, up to 30 characters (example: Maya hiking)\n\nOnce you confirm, this cannot be changed.',
  instructionAnon: 'On Circle, you appear as an anonymous user with a randomly assigned number. This cannot be changed, and you cannot add any personal information to your profile. Other users cannot see who you are.',
  debriefText: '[REPLACE WITH YOUR IRB-APPROVED DEBRIEF]\n\nThe platform you just used was simulated. All other users, posts, comments and like counts were pre-written by the researchers, and no other participant saw anything you did. Explain the true purpose of the study, why deception was necessary, how data will be used, and how to contact you or the IRB.',
  withdrawText: 'If you would like your data removed from the study, you can do so now with the button below, or later by contacting [RESEARCHER EMAIL]. You will not be penalized.'
};

const SEED_USERS = [
  { id: 'u1', fullName: 'Maya Chen',     pseudonym: 'MC2210',        anonNum: '4417', color: '#e17055' },
  { id: 'u2', fullName: 'Jordan Ellis',  pseudonym: 'Jordan baking', anonNum: '2086', color: '#0984e3' },
  { id: 'u3', fullName: 'Sam Okafor',    pseudonym: 'SO0731',        anonNum: '7731', color: '#00b894' },
  { id: 'u4', fullName: 'Riley Brooks',  pseudonym: 'Riley chess',   anonNum: '1359', color: '#6c5ce7' },
  { id: 'u5', fullName: 'Alex Moreno',   pseudonym: 'AM4182',        anonNum: '5902', color: '#d63031' },
  { id: 'u6', fullName: 'Priya Nair',    pseudonym: 'Priya film',    anonNum: '3174', color: '#e84393' },
  { id: 'u7', fullName: 'Tyler Webb',    pseudonym: 'TW2956',        anonNum: '6648', color: '#636e72' },
  { id: 'u8', fullName: 'Devon Park',    pseudonym: 'Devon running', anonNum: '8820', color: '#e58e26' }
];

// Placeholder stimuli: replace everything in the dashboard.
// types: neutral | good | violation | ambiguous | footprint
const SEED_POSTS = [
  { id: 'p1',  order: 1,  authorId: 'u3', type: 'neutral',   text: 'The library 3rd floor quiet room is open until 2am during finals week. Bring snacks.', imageUrl: '', likes: 18, minsAgo: 25,  active: 'TRUE' },
  { id: 'p2',  order: 2,  authorId: 'u1', type: 'good',      text: 'I got into the research program I applied to! Three rejections later, I finally made it. Thank you to everyone who helped with my essay.', imageUrl: '', likes: 14, minsAgo: 48, active: 'TRUE' },
  { id: 'p3',  order: 3,  authorId: 'u5', type: 'violation', text: 'Made a group chat for everyone from our lab section EXCEPT Dana. Reply if you want in.', imageUrl: '', likes: 11, minsAgo: 75, active: 'TRUE' },
  { id: 'p4',  order: 4,  authorId: 'u2', type: 'ambiguous', text: 'Hot take: people who study in groups are not learning, they are just socializing.', imageUrl: '', likes: 27, minsAgo: 110, active: 'TRUE' },
  { id: 'p5',  order: 5,  authorId: 'u8', type: 'neutral',   text: 'Does anyone know if the rec center extended its hours this week?', imageUrl: '', likes: 4, minsAgo: 150, active: 'TRUE' },
  { id: 'p6',  order: 6,  authorId: 'u4', type: 'good',      text: 'Made my first sourdough loaf and it actually rose!', imageUrl: '', likes: 20, minsAgo: 190, active: 'TRUE' },
  { id: 'p7',  order: 7,  authorId: 'u7', type: 'violation', text: 'Someone in my 9am totally bombed their presentation. I screenshotted the slides, this is gold.', imageUrl: '', likes: 22, minsAgo: 240, active: 'TRUE' },
  { id: 'p8',  order: 8,  authorId: 'u6', type: 'footprint', text: 'Reminder: what you post online can stay online forever. Think before you post.', imageUrl: '', likes: 33, minsAgo: 300, active: 'TRUE' },
  { id: 'p9',  order: 9,  authorId: 'u3', type: 'ambiguous', text: 'Roasting my roommate for his cooking in the group chat again. He is a great sport about it.', imageUrl: '', likes: 16, minsAgo: 360, active: 'TRUE' },
  { id: 'p10', order: 10, authorId: 'u1', type: 'neutral',   text: 'Free coffee at the student union until 11.', imageUrl: '', likes: 29, minsAgo: 420, active: 'TRUE' }
];

const SEED_COMMENTS = [
  { id: 'c1', postId: 'p2', authorId: 'u4', text: 'Congratulations, you deserve it!', likes: 3, order: 1 },
  { id: 'c2', postId: 'p2', authorId: 'u3', text: 'So proud of you!', likes: 2, order: 2 },
  { id: 'c3', postId: 'p2', authorId: 'u7', text: 'Cool story. Nobody asked, and honestly the essay thing is kind of pathetic.', likes: 41, order: 3 },
  { id: 'c4', postId: 'p2', authorId: 'u5', text: 'We get it, you are special. Log off.', likes: 36, order: 4 },
  { id: 'c5', postId: 'p6', authorId: 'u2', text: 'Looks amazing!', likes: 4, order: 1 },
  { id: 'c6', postId: 'p6', authorId: 'u7', text: 'bro it is literally bread. get a life', likes: 33, order: 2 },
  { id: 'c7', postId: 'p3', authorId: 'u2', text: 'lol add me', likes: 6, order: 1 },
  { id: 'c8', postId: 'p4', authorId: 'u8', text: 'facts', likes: 8, order: 1 },
  { id: 'c9', postId: 'p4', authorId: 'u5', text: 'you clearly have no friends', likes: 14, order: 2 }
];
