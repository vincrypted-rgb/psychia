// Tiny shared helpers for both pages.
window.h = function (tag, props, ...kids) {
  const e = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((k) => { if (k !== null && k !== undefined && k !== false) e.append(k); });
  return e;
};

window.api = {
  ready() { return window.API_URL && window.API_URL.indexOf('http') === 0; },
  async get(params) {
    const u = new URL(window.API_URL);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u.toString());
    return r.json();
  },
  async post(body) {
    const r = await fetch(window.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    return r.json();
  },
  beacon(body) {
    try {
      return navigator.sendBeacon(window.API_URL, new Blob([JSON.stringify(body)], { type: 'text/plain;charset=utf-8' }));
    } catch (e) { return false; }
  }
};
