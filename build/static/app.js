/* nixgen — client. Vanilla JS, no build step. */

/* Shown in the header. Bump it whenever this file changes, so "the fix did not
   work" can be told apart from "the old file is still being served". */
const BUILD = '2026-08-05f';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

/* Machine translation must not touch Nix identifiers. `translate="no"` is the
   standard way to say so, but not every translator honours it, and a mangled
   `services.openssh.enable` is worse than useless. So we also record the
   canonical text on the node and put it back if anything rewrites it.
   Descriptions are left alone — they are the only prose here, and translating
   them is the whole point. */
function ident(text, cls) {
  const n = document.createElement('span');
  if (cls) n.className = cls;
  n.classList.add('notranslate');
  n.setAttribute('translate', 'no');
  n.dataset.keep = text;
  n.textContent = text;
  return n;
}

function keep(n) {
  n.setAttribute('translate', 'no');
  n.classList.add('notranslate');
  n.dataset.keep = n.textContent;
  return n;
}

/* Repair anything a translator rewrote. Comparing against the stored text
   makes this self-terminating: our own repair produces no further change. */
function guardIdentifiers(root) {
  const fix = () => {
    for (const n of root.querySelectorAll('[data-keep]')) {
      if (n.textContent === n.dataset.keep) continue;
      // The code pane carries syntax colouring, so rebuild it rather than
      // flattening it back to plain text.
      if (n.id === 'out') paintCode(currentText());
      else n.textContent = n.dataset.keep;
    }
  };
  new MutationObserver(fix).observe(root, {
    subtree: true, childList: true, characterData: true,
  });
  return fix;
}

/* Placeholders inside option paths: <name>, <n>, *, and a few odd upstream
   artifacts. Used with both .match() and .test(), so lastIndex is reset. */
const SLOT = /<[^>]*>|\*/g;
const isSlot = s => { SLOT.lastIndex = 0; return SLOT.test(s); };

/* NixOS descriptions carry docbook-ish markup: {option}`x`, {command}`y`,
   [](#opt-services.foo). None of it means anything here. */
function clean(d) {
  if (!d) return '';
  return d
    .replace(/\[\]\(#opt-([^)]*)\)/g, '$1')
    .replace(/\{(option|command|file|var|env|manpage|program)\}/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
function clip(d, n) {
  if (d.length <= n) return d;
  const cut = d.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.]$/, '') + '…';
}

const state = {
  kind: 'options',
  channel: 'nixos',
  selected: new Map(),   // key -> entry
  verbatim: new Set(),   // resolved paths copied straight from the user's file
  file: 'generated.nix', // which file the output pane is showing
  starter: {},           // configuration.nix / flake.nix, from /api/starter
  starterDefines: new Set(), // option paths the starter configuration.nix sets
  unfree: new Set(),     // attrs that need nixpkgs.config.allowUnfree
  lastTouched: null,
};

/* ------------------------------------------------------------------ boot */

(async function init() {
  const meta = await fetch('/api/meta').then(r => r.json());
  state.channel = meta.channel || 'nixos';
  $('#channel').textContent = state.channel;
  $('#counts').textContent =
    `${(+meta.option_count).toLocaleString()} options · ` +
    `${(+meta.package_count).toLocaleString()} packages · build ${BUILD}`;
  runSearch();
  renderEditor();
  loadStarter();
  guardIdentifiers(document.body);
})();

/* ---------------------------------------------------------------- search */

let searchTimer;
$('#q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 140);
});
$('#only-supported').addEventListener('change', runSearch);

$$('#pane-catalog .tab').forEach(t => t.addEventListener('click', () => {
  $$('#pane-catalog .tab').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  state.kind = t.dataset.kind;
  const setup = state.kind === 'setup';
  $('.searchwrap').hidden = setup;
  $('#results').hidden = setup;
  $('#setup').hidden = !setup;
  // the output pane follows the tab you are on
  showFile(setup ? 'configuration.nix' : 'generated.nix');
  if (setup) return;
  $('#filterline').style.display = state.kind === 'options' ? '' : 'none';
  $('#q').placeholder = state.kind === 'options'
    ? 'openssh, firewall, timeZone…'
    : 'firefox, ripgrep, obsidian…';
  runSearch();
}));

/* ---------------------------------------------------------- starter files */

let starterTimer;
function onSetupChange() {
  clearTimeout(starterTimer);
  starterTimer = setTimeout(loadStarter, 200);
}
const SETUP_FIELDS = ['s-host', 's-user', 's-system', 's-bootloader',
  's-grub-device', 's-networkmanager', 's-flakes', 's-make-user',
  's-groups', 's-state'];
SETUP_FIELDS.forEach(id => {
  const n = $('#' + id);
  n.addEventListener('input', onSetupChange);
  n.addEventListener('change', onSetupChange);
});

/* The host name becomes a Nix attribute (nixosConfigurations.<host>) and the
   user name an attribute under users.users, so both have to be plain
   identifiers. The server falls back to a safe value; say so rather than
   quietly substituting one. */
const NAME_OK = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function checkName(id, fallback) {
  const input = $('#' + id);
  const warn = $('#' + id + '-warn');
  const ok = NAME_OK.test(input.value.trim());
  input.classList.toggle('bad', !ok);
  warn.hidden = ok;
  if (!ok) warn.textContent =
    `Letters, digits, - and _ only, starting with a letter. Using "${fallback}" for now.`;
  return ok;
}

/* Fields that only matter for one choice are hidden rather than disabled —
   a GRUB disk path is noise on a UEFI machine. */
function syncSetupVisibility() {
  const grub = $('#s-bootloader').value === 'grub';
  $('#s-grub-wrap').hidden = !grub;
  $('#s-grub-note').hidden = !grub;
  const user = $('#s-make-user').checked;
  $('#s-groups-wrap').hidden = !user;
  $('#s-groups-note').hidden = !user;
  $('#s-user').parentElement.hidden = !user;
}

function checkStateVersion() {
  const input = $('#s-state');
  const warn = $('#s-state-warn');
  const ok = /^\d\d\.\d\d$/.test(input.value.trim());
  input.classList.toggle('bad', !ok);
  warn.hidden = ok;
  if (!ok) warn.textContent = 'Two digits, a dot, two digits — 26.05. Falling back for now.';
}

async function loadStarter() {
  syncSetupVisibility();
  checkName('s-host', 'nixos');
  if ($('#s-make-user').checked) checkName('s-user', 'user');
  checkStateVersion();
  const host = $('#s-host').value.trim() || 'nixos';
  const q = new URLSearchParams({
    host,
    user: $('#s-user').value.trim(),
    system: $('#s-system').value,
    bootloader: $('#s-bootloader').value,
    grub_device: $('#s-grub-device').value.trim(),
    networkmanager: $('#s-networkmanager').checked ? '1' : '0',
    make_user: $('#s-make-user').checked ? '1' : '0',
    groups: $('#s-groups').value,
    flakes: $('#s-flakes').checked ? '1' : '0',
    state_version: $('#s-state').value.trim(),
  });
  state.starter = await fetch('/api/starter?' + q).then(r => r.json());
  state.starterDefines = new Set(state.starter.defines || []);
  pushRender();
  $('#s-cmd2').textContent = `sudo nixos-rebuild switch --flake /etc/nixos#${host}`;
  if (state.file !== 'generated.nix') paintCode(currentText());
}

$$('.filetabs .tab').forEach(t =>
  t.addEventListener('click', () => showFile(t.dataset.file)));

function showFile(name) {
  state.file = name;
  $$('.filetabs .tab').forEach(x =>
    x.setAttribute('aria-selected', String(x.dataset.file === name)));
  $('#btn-dl').textContent = 'Download ' + name;
  paintCode(currentText());
}

async function runSearch() {
  const q = $('#q').value.trim();
  const sup = $('#only-supported').checked ? '1' : '';
  const url = `/api/search?kind=${state.kind}&q=${encodeURIComponent(q)}&supported=${sup}&limit=80`;
  const { results } = await fetch(url).then(r => r.json());
  state.kind === 'options' ? paintOptions(results, q) : paintPackages(results);
}

function mark(text, q) {
  const frag = document.createDocumentFragment();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return document.createTextNode(text);
  const rx = new RegExp('(' + tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
  text.split(rx).forEach((part, i) => {
    frag.appendChild(i % 2 ? el('b', null, part) : document.createTextNode(part));
  });
  return frag;
}

function paintOptions(rows, q) {
  const box = $('#results');
  box.innerHTML = '';
  if (!rows.length) { box.appendChild(el('div', 'empty', 'No option matches that. Try a shorter word.')); return; }
  rows.forEach(r => {
    const b = el('button', 'row' + (state.selected.has(r.path) ? ' added' : ''));
    const p = el('div', 'p');
    const name = ident(r.path);
    name.textContent = '';
    name.appendChild(mark(r.path, q));
    p.appendChild(name);
    if (!r.supported) p.appendChild(el('span', 'badge raw', 'nix'));
    if (r.has_slot) p.appendChild(el('span', 'badge slot', 'name'));
    b.appendChild(p);
    if (r.description) {
      const d = el('div', 'd', clean(r.description));
      d.lang = 'en';
      b.appendChild(d);
    }
    b.appendChild(ident(r.type_str || '—', 't'));
    b.addEventListener('click', () => addOption(r.path));
    box.appendChild(b);
  });
}

function paintPackages(rows) {
  const box = $('#results');
  box.innerHTML = '';
  if (!rows.length) { box.appendChild(el('div', 'empty', 'No package matches that.')); return; }
  rows.forEach(r => {
    const b = el('button', 'row');
    const p = el('div', 'p');
    p.appendChild(ident(r.attr));
    if (r.unfree) p.appendChild(el('span', 'badge unfree', 'unfree'));
    if (r.broken) p.appendChild(el('span', 'badge broken', 'broken'));
    b.appendChild(p);
    if (r.description) b.appendChild(el('div', 'd', r.description));
    b.appendChild(ident(r.version || '', 't'));
    b.addEventListener('click', () => addPackage(r.attr, r.unfree));
    box.appendChild(b);
  });
}

/* ------------------------------------------------------------- selection */

function freeKey(path) {
  if (!state.selected.has(path)) return path;
  let n = 2;
  while (state.selected.has(path + '#' + n)) n++;
  return path + '#' + n;
}

async function addOption(path) {
  if (state.selected.has(path)) { flashCard(path); return; }
  const opt = await fetch('/api/option?path=' + encodeURIComponent(path)).then(r => r.json());
  if (opt.error) return;
  const slots = (path.match(SLOT) || []);
  state.selected.set(path, {
    path,
    type: opt.type,
    type_str: opt.type_str,
    description: opt.description,
    default_txt: opt.default_txt,
    example_txt: opt.example_txt,
    slots: slots.map(() => ''),
    value: seed(opt.type, opt.default_txt),
  });
  state.lastTouched = path;
  renderEditor(); runSearch(); pushRender();
}

/* Find a selection entry by the path it will actually render to. Import can
   file the same option under a suffixed key, so looking it up by map key is
   not enough. */
function findEntry(path) {
  for (const e of state.selected.values()) if (resolvePath(e) === path) return e;
  return null;
}

const TOP_OPTION = 'environment.systemPackages';

/* Order package-ish items by name, ignoring wrapping parens and the pkgs
   prefix. Must stay in step with sort_key() in nixgen_core.py. */
function sortKey(item) {
  let s = String(item).trim().replace(/^\(+\s*/, '');
  if (s.startsWith('pkgs.')) s = s.slice(5);
  const m = s.match(/^[A-Za-z0-9_.'-]+/);
  return (m ? m[0] : s).toLowerCase();
}
const byName = (a, b) => {
  const ka = sortKey(a), kb = sortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : String(a) < String(b) ? -1 : 1;
};

const rxEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Append a package to a list that was copied over verbatim, e.g.
   `with pkgs; [ … (vscode.override { … }) … ]`. Rebuilding it as a widget
   value would throw away the parts a form cannot hold, so the text is edited
   in place instead. */
function appendToNixList(src, attr) {
  const text = String(src).replace(/\s+$/, '');
  const open = text.indexOf('[');
  const close = text.lastIndexOf(']');
  if (open < 0 || close < open) return null;

  const scoped = /(^|\s)with\s+pkgs\s*;/.test(text.slice(0, open));
  const item = scoped ? attr : 'pkgs.' + attr;
  if (new RegExp('(^|[\\s\\[])' + rxEscape(item) + '(?=[\\s\\]]|$)').test(text)) return text;

  const inner = text.slice(open + 1, close);
  const closeIndent = (text.slice(0, close).match(/\n([ \t]*)$/) || [null, ''])[1];
  const multiline = inner.includes('\n');

  // Elements are whitespace-separated at this level; anything containing
  // brackets or braces is kept whole by matching balanced runs.
  const items = splitNixList(inner);
  items.push(item);
  items.sort(byName);

  if (!multiline) return text.slice(0, open + 1) + ' ' + items.join(' ') + ' ]';

  let indent = closeIndent + '  ';
  const first = inner.split('\n').find(l => l.trim());
  if (first) indent = (first.match(/^[ \t]*/) || [''])[0] || indent;
  return text.slice(0, open + 1) + '\n' +
         items.map(x => indent + x).join('\n') + '\n' + closeIndent + ']';
}

/* Split a list body into elements, keeping bracketed and quoted runs whole. */
function splitNixList(body) {
  const out = [];
  let i = 0;
  const pairs = { '{': '}', '[': ']', '(': ')' };
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    const start = i;
    let depth = 0;
    while (i < body.length) {
      const c = body[i];
      if (c in pairs) { depth++; i++; }
      else if (c === '}' || c === ']' || c === ')') { depth--; i++; }
      else if (c === '"') { i++; while (i < body.length && body[i] !== '"') i += body[i] === '\\' ? 2 : 1; i++; }
      else if (/\s/.test(c) && depth === 0) break;
      else i++;
    }
    out.push(body.slice(start, i).trim());
  }
  return out.filter(Boolean);
}

async function addPackage(attr, unfree) {
  if (unfree) state.unfree.add(attr);
  const path = 'environment.systemPackages';

  let e = findEntry(path);
  if (!e) { await addOption(path); e = findEntry(path); }
  if (!e) return;

  if (Array.isArray(e.value)) {
    if (!e.value.includes(attr)) e.value.push(attr);
    e.value.sort(byName);
  } else {
    // The entry came in verbatim; keep every element that is already there.
    const merged = appendToNixList(e.value, attr);
    if (merged === null) {
      setStatus(`Could not add ${attr}: environment.systemPackages holds an ` +
                `expression this tool cannot edit. Add it by hand.`, 'bad');
      return;
    }
    e.value = merged;
  }

  state.lastTouched = e.path;

  /* Rebuilding the card would reset a box the user had dragged taller, so when
     the control is a text box just update its text in place. Chip lists have
     no size of their own and are rebuilt as before. */
  const card = $(`.card[data-path="${CSS.escape(e.path)}"]`);
  const ta = card && card.querySelector('textarea');
  if (ta && !Array.isArray(e.value)) {
    ta.value = e.value;
    autosize(ta);
  } else {
    renderEditor();
  }
  pushRender();
}

function seed(node, defTxt) {
  switch (node.kind) {
    case 'bool':  return defTxt === 'true';
    case 'enum':  return unquote(defTxt) ?? node.values[0];
    case 'int': case 'float': {
      const n = Number(defTxt);
      return Number.isFinite(n) ? n : (node.min ?? 0);
    }
    case 'str': case 'lines': case 'path': return unquote(defTxt) ?? '';
    case 'package': return '';
    case 'list':  return [];
    case 'attrs': return {};
    case 'nullable': return { __null: false, v: seed(node.inner, defTxt) };
    default: return defTxt && defTxt !== 'null' ? defTxt : '';
  }
}

function unquote(t) {
  if (!t) return null;
  const m = /^"([\s\S]*)"$/.exec(t.trim());
  return m ? m[1] : null;
}

/* ---------------------------------------------------------------- widgets */

function widget(node, get, set) {
  const wrap = el('div', 'control');

  if (node.kind === 'nullable') {
    const cur = get() ?? { __null: true, v: seed(node.inner, null) };
    const row = el('label', 'nullrow');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!cur.__null;
    row.append(cb, el('span', null, 'null (leave unset)'));
    wrap.appendChild(row);
    const inner = widget(node.inner, () => cur.v, v => { cur.v = v; set(cur); });
    inner.style.opacity = cur.__null ? .4 : 1;
    inner.querySelectorAll('input,select,textarea,button').forEach(x => x.disabled = cur.__null);
    cb.addEventListener('change', () => { cur.__null = cb.checked; set(cur); });
    wrap.appendChild(inner);
    return wrap;
  }

  if (node.kind === 'bool') {
    const lab = el('label', 'toggle');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!get();
    const txt = el('span', null, cb.checked ? 'true' : 'false');
    cb.addEventListener('change', () => { txt.textContent = cb.checked ? 'true' : 'false'; set(cb.checked); });
    lab.append(cb, txt);
    wrap.appendChild(lab);
    return wrap;
  }

  if (node.kind === 'enum') {
    const s = el('select');
    node.values.forEach(v => { const o = el('option', null, v); o.value = v; s.appendChild(o); });
    s.value = get();
    s.addEventListener('change', () => set(s.value));
    wrap.appendChild(s);
    return wrap;
  }

  if (node.kind === 'int' || node.kind === 'float') {
    const i = el('input'); i.type = 'number'; i.value = get();
    if (node.min != null) i.min = node.min;
    if (node.max != null) i.max = node.max;
    if (node.kind === 'float') i.step = 'any';
    i.addEventListener('input', () => set(Number(i.value)));
    wrap.appendChild(i);
    return wrap;
  }

  if (node.kind === 'lines' || node.kind === 'raw') {
    const t = el('textarea');
    t.value = get() ?? '';
    t.placeholder = node.kind === 'raw' ? 'Nix expression — written verbatim into the file' : '';
    t.spellcheck = false;
    t.addEventListener('input', () => { set(t.value); autosize(t); });
    autosize(t);   // renderEditor may override this with a remembered height
    wrap.appendChild(t);
    return wrap;
  }

  if (node.kind === 'package') {
    wrap.appendChild(packagePicker(get(), set));
    return wrap;
  }

  if (node.kind === 'list') {
    if (node.inner.kind === 'package') {
      const chips = el('div', 'chips');
      (get() || []).forEach((v, idx) => {
        const c = el('span', 'chip');
        c.appendChild(ident(v));
        const x = keep(el('button', null, '×'));
        x.title = 'Remove ' + v;
        x.addEventListener('click', () => { const a = get(); a.splice(idx, 1); set(a); rerender(); });
        c.appendChild(x); chips.appendChild(c);
      });
      wrap.appendChild(chips);
      wrap.appendChild(packagePicker('', v => { const a = get() || []; if (!a.includes(v)) a.push(v); set(a); rerender(); }, true));
      return wrap;
    }
    const items = el('div', 'items');
    (get() || []).forEach((v, idx) => {
      const row = el('div', 'item');
      const inner = widget(node.inner, () => get()[idx], nv => { const a = get(); a[idx] = nv; set(a); });
      inner.style.marginTop = '0'; inner.style.flex = '1';
      const rm = el('button', 'mini', '−');
      rm.addEventListener('click', () => { const a = get(); a.splice(idx, 1); set(a); rerender(); });
      row.append(inner, rm);
      items.appendChild(row);
    });
    const add = el('button', 'mini', '+ add item');
    add.addEventListener('click', () => { const a = get() || []; a.push(seed(node.inner, null)); set(a); rerender(); });
    wrap.append(items, add);
    return wrap;
  }

  if (node.kind === 'attrs') {
    const items = el('div', 'items');
    Object.entries(get() || {}).forEach(([k, v]) => {
      const row = el('div', 'item');
      const kin = el('input', 'k'); kin.type = 'text'; kin.value = k; kin.placeholder = 'name';
      kin.addEventListener('change', () => {
        const o = get(); const val = o[k]; delete o[k]; o[kin.value] = val; set(o); rerender();
      });
      const inner = widget(node.inner, () => get()[k], nv => { const o = get(); o[k] = nv; set(o); });
      inner.style.marginTop = '0'; inner.style.flex = '1';
      const rm = el('button', 'mini', '−');
      rm.addEventListener('click', () => { const o = get(); delete o[k]; set(o); rerender(); });
      row.append(kin, inner, rm);
      items.appendChild(row);
    });
    const add = el('button', 'mini', '+ add entry');
    add.addEventListener('click', () => {
      const o = get() || {}; let n = 1; while (o['key' + n] !== undefined) n++;
      o['key' + n] = seed(node.inner, null); set(o); rerender();
    });
    wrap.append(items, add);
    return wrap;
  }

  // str, path, and anything scalar left over
  const i = el('input'); i.type = 'text'; i.value = get() ?? '';
  i.spellcheck = false;
  if (node.kind === 'path') i.placeholder = '/etc/…';
  i.addEventListener('input', () => set(i.value));
  wrap.appendChild(i);
  return wrap;
}

/* Grow a text box to fit what is in it. A one-line expression should not take
   up as much room as an imported package list of twenty entries. The ceiling
   keeps a very long value from pushing everything else off the screen; the box
   stays draggable past it. */
function autosize(t) {
  if (t.style.height) return;   // the user dragged it; leave it alone
  const lines = String(t.value || '').split('\n').length;
  t.rows = Math.min(Math.max(lines, 3), 11);
}

function packagePicker(initial, onPick, clearAfter) {
  const box = el('div', 'pkgpick');
  const i = el('input'); i.type = 'text'; i.value = initial || '';
  i.placeholder = 'search nixpkgs…'; i.spellcheck = false;
  i.style.cssText = 'width:100%;padding:6px 8px;border:1px solid var(--rule);border-radius:3px;background:#fff;font-family:var(--mono);font-size:12px';
  const sug = el('div', 'sugg'); sug.style.display = 'none';
  let t;
  const close = () => { sug.style.display = 'none'; };
  i.addEventListener('blur', () => setTimeout(close, 160));
  i.addEventListener('input', () => {
    onPick && !clearAfter && onPick(i.value);
    clearTimeout(t);
    const q = i.value.trim();
    if (q.length < 2) return close();
    t = setTimeout(async () => {
      const { results } = await fetch('/api/search?kind=packages&limit=12&q=' + encodeURIComponent(q)).then(r => r.json());
      sug.innerHTML = '';
      results.forEach(r => {
        const b = el('button');
        b.appendChild(ident(r.attr + '  '));
        b.appendChild(el('small', null, r.description ? r.description.slice(0, 60) : ''));
        b.addEventListener('mousedown', ev => {
          ev.preventDefault();
          onPick(r.attr);
          if (clearAfter) i.value = ''; else i.value = r.attr;
          close();
        });
        sug.appendChild(b);
      });
      sug.style.display = results.length ? 'block' : 'none';
    }, 160);
  });
  box.append(i, sug);
  return box;
}

/* ---------------------------------------------------------------- editor */

function rerender() { renderEditor(); pushRender(); }

function renderEditor() {
  const box = $('#editor');
  box.innerHTML = '';
  $('#sel-count').textContent = state.selected.size;

  if (!state.selected.size) {
    const e = el('div', 'empty');
    e.innerHTML = 'Nothing set yet.<br>Search on the left and click an option to add it here.';
    box.appendChild(e);
    return;
  }

  // The package list is the one people come back to, so it stays on top.
  const entries = [...state.selected.values()].sort((a, b) =>
    (b.path === TOP_OPTION ? 1 : 0) - (a.path === TOP_OPTION ? 1 : 0));

  for (const entry of entries) {
    const card = el('div', 'card'
      + (entry.path === state.lastTouched ? ' touched' : '')
      + (entry.verbatim ? ' verbatim' : ''));
    card.dataset.path = entry.path;

    const head = el('div', 'head');
    head.appendChild(ident(entry.path, 'path'));
    if (state.starterDefines.has(resolvePath(entry))) {
      const w = el('span', 'badge clash', 'also in configuration.nix');
      w.title = 'The starter configuration.nix sets this too. Remove it from one of them.';
      head.appendChild(w);
    }
    if (entry.verbatim) {
      head.appendChild(el('span', 'badge vb',
        entry.verbatim === 'unknown' ? 'not in this release'
          : entry.verbatim === 'structure' ? 'module structure' : 'verbatim'));
    }
    const drop = el('button', 'drop', '×');
    drop.title = 'Remove from module';
    drop.addEventListener('click', () => { state.selected.delete(entry.path); rerender(); runSearch(); });
    head.appendChild(drop);
    card.appendChild(head);

    card.appendChild(ident(entry.type_str || '—', 'type'));
    if (entry.description) {
      const desc = el('div', 'desc', clip(clean(entry.description), 240));
      desc.lang = 'en';
      card.appendChild(desc);
    }

    // <name> placeholders in the option path
    if (entry.slots.length) {
      const names = entry.path.match(SLOT) || [];
      names.forEach((slot, i) => {
        const line = el('label', 'slotline');
        line.appendChild(el('span', 'eyebrow', slot.replace(/[<>]/g, '')));
        const inp = el('input'); inp.type = 'text'; inp.value = entry.slots[i] || '';
        inp.placeholder = 'name for this ' + slot;
        inp.style.cssText = 'padding:5px 7px;border:1px solid var(--rule);border-radius:3px;font-family:var(--mono);font-size:12px';
        inp.addEventListener('input', () => { entry.slots[i] = inp.value; pushRender(); });
        line.appendChild(inp);
        card.appendChild(line);
      });
    }

    const control = widget(entry.type, () => entry.value, v => {
      entry.value = v; state.lastTouched = entry.path; pushRender();
    });
    card.appendChild(control);

    /* Adding a package rebuilds every card, which would otherwise throw away a
       box the user had dragged taller. Keep the height on the entry. */
    const ta = control.querySelector('textarea');   // not `box` — that is #editor
    if (ta) {
      if (entry.uiHeight) ta.style.height = entry.uiHeight;
      new ResizeObserver(() => {
        if (ta.style.height) entry.uiHeight = ta.style.height;
      }).observe(ta);
    }

    if (entry.default_txt) {
      card.appendChild(ident('default: ' + entry.default_txt.replace(/\s+/g, ' ').slice(0, 120), 'hint'));
    }
    box.appendChild(card);
  }
}

function flashCard(path) {
  const c = $(`.card[data-path="${CSS.escape(path)}"]`);
  if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ---------------------------------------------------------------- output */

let renderTimer, generatedText = '';

function currentText() {
  return state.file === 'generated.nix'
    ? generatedText
    : (state.starter[state.file] || '');
}

function pushRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(doRender, 120);
}

/* Split on dots but keep <placeholders> atomic — a few upstream option keys
   contain dots inside their angle brackets. */
function segmentsFor(entry) {
  let i = 0;
  return (entry.path.match(/<[^>]*>|[^.]+/g) || []).map(seg =>
    isSlot(seg) ? ((entry.slots[i++] || '').trim() || 'CHANGE_ME') : seg
  );
}
function resolvePath(entry) { return segmentsFor(entry).join('.'); }

async function doRender() {
  state.verbatim = new Set(
    [...state.selected.values()].filter(e => e.verbatim).map(e => resolvePath(e)));
  const entries = [...state.selected.values()].map(e => ({
    path: resolvePath(e),
    segments: e.segments || segmentsFor(e),
    type: e.type,
    value: e.value,
    note: e.note,
  }));
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries, channel: state.channel }),
  }).then(r => r.json());
  generatedText = res.text;
  if (state.file === 'generated.nix') paintCode(res.text);
  const notes = [];
  const todo = (res.text.match(/CHANGE_ME/g) || []).length;
  if (todo) notes.push(`${todo} name${todo > 1 ? 's' : ''} still to fill in — look for CHANGE_ME.`);
  const clashes = [...state.starterDefines].filter(
    p => new RegExp('^  ' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' =', 'm').test(res.text));
  if (clashes.length) {
    notes.push(`Also set in the starter configuration.nix: ${clashes.join(', ')}. ` +
               `Shown in red. Delete it from one of the two files — if both use ` +
               `lib.mkDefault, NixOS cannot choose and the rebuild fails.`);
  }
  const unfree = [...state.unfree].filter(a => res.text.includes('pkgs.' + a));
  if (unfree.length) {
    notes.push(`${unfree.join(', ')} ${unfree.length > 1 ? 'are' : 'is'} unfree. ` +
               `Set nixpkgs.config.allowUnfree = true; in your configuration.nix.`);
  }
  if (notes.length) setStatus(notes.join('\n'), 'todo');
  else if ($('#status').classList.contains('todo')) setStatus('');
}

function paintCode(text) {
  const pre = $('#out');
  pre.innerHTML = '';
  const touched = state.lastTouched ? resolvePath(state.selected.get(state.lastTouched) || { path: '', slots: [] }) : null;
  text.split('\n').forEach(line => {
    const span = el('span');
    if (/^\s*#/.test(line)) {
      span.className = 'c'; span.textContent = line;
    } else {
      const m = /^(\s*)([\w.'"-]+)( = )([\s\S]*)$/.exec(line);
      if (m) {
        span.appendChild(document.createTextNode(m[1]));
        const k = el('span', 'k', m[2]);
        if (touched && m[2] === touched) {
          const mk = el('mark'); mk.appendChild(k); span.appendChild(mk);
        } else span.appendChild(k);
        span.appendChild(document.createTextNode(m[3]));
        span.appendChild(el('span', 'v', m[4]));
        if (state.file === 'generated.nix' && state.verbatim.has(m[2]))
          span.classList.add('verbatim');
        if (state.file === 'generated.nix' && state.starterDefines.has(m[2]))
          span.classList.add('clash');
      } else span.textContent = line;
    }
    if (line.includes('CHANGE_ME')) span.classList.add('todo');
    pre.append(span, document.createTextNode('\n'));
  });
  pre.dataset.keep = pre.textContent;
}

/* ---------------------------------------------------------------- import */

$('#btn-import').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async ev => {
  const f = ev.target.files[0];
  if (!f) return;
  ev.target.value = '';
  const text = await f.text();
  setStatus('Reading ' + f.name + '…');
  const r = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(r => r.json());

  if (r.error) {
    showNotice([{ cls: 'bad', title: 'Could not read that file', body: r.error }]);
    setStatus('Import failed.', 'bad');
    return;
  }

  for (const m of r.matched) {
    state.selected.set(freeKey(m.path), {
      path: m.path,
      type: m.type,
      type_str: m.type_str,
      description: m.description,
      default_txt: m.default_txt,
      example_txt: m.example_txt,
      slots: m.slots || [],
      value: m.value,
    });
  }
  const verbatim = [
    ...(r.structure || []).map(x => ({ ...x, from: x.path, kind: 'structure' })),
    ...r.expression.map(x => ({ ...x, path: x.option, from: x.path, kind: 'expression' })),
    ...r.unknown.map(x => ({ ...x, from: x.path, kind: 'unknown' })),
  ];
  for (const v of verbatim) {
    state.selected.set(freeKey(v.from), {
      path: v.from,
      segments: v.segments,
      type: { kind: 'raw', label: v.type_str || 'module structure' },
      type_str: v.type_str || (v.kind === 'structure' ? 'module structure' : 'not an option in this release'),
      description: v.why || '',
      default_txt: null,
      slots: [],
      value: v.source,
      note: v.note,
      verbatim: v.kind,
    });
  }
  state.lastTouched = null;

  const notes = [];
  notes.push({ cls: 'ok', title: `Imported ${r.matched.length} settings from ${f.name}`,
               body: r.used_nix
                 ? 'Parsed with nix-instantiate. Your file was not modified.'
                 : 'Read directly — nix-instantiate was not on PATH.' });
  (r.notes || []).forEach(n => notes.push({ cls: 'warn', title: 'Adjusted while reading', body: n }));
  if (r.structure && r.structure.length) {
    notes.push({ cls: 'ok',
      title: `${r.structure.length} module-structure line(s) carried over`,
      list: r.structure.map(x => `${x.path} = ${x.preview}`),
      body: 'imports and friends are copied through unchanged. Keep this file in the same directory as the one you imported, so its relative paths still resolve.' });
  }
  if (r.expression.length) {
    notes.push({ cls: 'warn',
      title: `${r.expression.length} kept as written: the value is an expression`,
      list: r.expression.map(x => `${x.option} = ${x.preview}`),
      body: 'lib.mkIf, let bindings and the like cannot go in a form, so they are copied into the output unchanged and highlighted. If one refers to a let binding from your original file, define it there too or Check syntax will flag it.' });
  }
  if (r.unknown.length) {
    notes.push({ cls: 'warn', title: `${r.unknown.length} kept as written: not an option in this release`,
      list: r.unknown.map(x => `${x.path} — ${x.why}`),
      body: 'Copied into the output unchanged so nothing is lost. Highlighted in the file — check each one, since nixos-rebuild will reject an option that no longer exists.' });
  }
  showNotice(notes);
  rerender();
  runSearch();
  setStatus(`Imported ${r.matched.length} settings.`, 'ok');
});

function showNotice(items) {
  const box = $('#notice');
  box.innerHTML = '';
  if (!items.length) return;
  items.forEach(it => {
    const n = el('div', 'notice ' + it.cls);
    n.appendChild(el('div', 'nt', it.title));
    if (it.body) n.appendChild(el('div', 'nb', it.body));
    if (it.list) {
      const ul = el('ul', 'nl');
      it.list.slice(0, 40).forEach(t => ul.appendChild(keep(el('li', null, t))));
      if (it.list.length > 40) ul.appendChild(el('li', null, `…and ${it.list.length - 40} more`));
      n.appendChild(ul);
    }
    box.appendChild(n);
  });
  const x = el('button', 'mini', 'dismiss');
  x.addEventListener('click', () => { box.innerHTML = ''; });
  box.appendChild(x);
}

/* --------------------------------------------------------------- actions */

$('#btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentText());
    setStatus('Copied to clipboard.', 'ok');
  } catch {
    setStatus('Clipboard blocked by the browser. Use Download instead.', 'bad');
  }
});

$('#btn-dl').addEventListener('click', () => {
  const blob = new Blob([currentText()], { type: 'text/plain' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = state.file;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#btn-check').addEventListener('click', async () => {
  setStatus('Checking…');
  const r = await fetch('/api/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: currentText() }),
  }).then(r => r.json());
  setStatus(r.message, r.ok === true ? 'ok' : r.ok === false ? 'bad' : '');
});

function setStatus(msg, cls = '') {
  const s = $('#status');
  s.className = 'status ' + cls;
  s.textContent = msg;
}

/* --------------------------------------------------------------- mobile */

$$('.mobilebar .tab').forEach(t => t.addEventListener('click', () => {
  $$('.mobilebar .tab').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  $$('main .pane').forEach(p => p.classList.toggle('active', p.id === t.dataset.pane));
}));
