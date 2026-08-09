/* nixgen — client. Vanilla JS, no build step. */

/* Shown in the header. Bump it whenever this file changes, so "the fix did not
   work" can be told apart from "the old file is still being served". */
const BUILD = '2026-08-09w';

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
  kind: 'setup',     // what a new machine needs first
  channel: 'nixos',
  selected: new Map(),   // key -> entry
  verbatim: new Set(),   // resolved paths copied straight from the user's file
  file: 'generated.nix', // which file the output pane is showing
  starter: {},           // configuration.nix / flake.nix, from /api/starter
  starterDefines: new Set(), // option paths the starter configuration.nix sets
  releases: [],          // channels that publish option data, unstable last
  indexed: null,         // the channel the search index was built from
  built: [],             // channels already indexed on this machine
  releaseOf: {},         // channel -> NixOS version, for the built ones
  unused: [],            // indexes for channels that are no longer offered
  unstable: 'nixos-unstable',
  snapshot: null,        // when the channel published the indexed data
  ageDays: null,         // …and how many days ago that was
  stale: false,          // …and whether that is long enough to matter here
  unfree: new Set(),     // attrs that need nixpkgs.config.allowUnfree
  lastTouched: null,
  stateTouched: false,   // whether stateVersion was typed in by hand
};

/* system.stateVersion follows the channel until someone types in the box.
   `nixos-26.05` says its version in its name; `nixos-unstable` does not, so the
   index records what the catalogue said — 26.11 today. Leaving 26.05 in the box
   on unstable would be a wrong answer presented as a considered one, in the one
   field the copy tells you not to change later. */
function setStateVersion(release, channel) {
  if (state.stateTouched) return;
  // An index built before nixgen recorded the release has no answer, so fall
  // back to the channel's own name — which is where it came from anyway, for
  // everything except unstable.
  const m = /\d\d\.\d\d/.exec(release || '') || /\d\d\.\d\d/.exec(channel || '');
  if (m) $('#s-state').value = m[0];
}

/* ------------------------------------------------------------------ boot */

(async function init() {
  const meta = await fetch('/api/meta').then(r => r.json());
  state.channel = meta.channel || 'nixos';
  $('#channel').textContent = state.channel;
  $('#counts').textContent =
    `${(+meta.option_count).toLocaleString()} options · ` +
    `${(+meta.package_count).toLocaleString()} packages · build ${BUILD}`;
  setStateVersion(meta.release, meta.channel);
  // The file names, option paths and the directory listing in the steps are
  // Nix, not prose, so they are guarded like every other identifier here.
  $$('#howto code, #howto .tree').forEach(keep);
  // Every choice in the form is written in both languages already, so a
  // translator rewriting one is exactly what the second language is there to
  // prevent. `translate="no"` says so and this makes it stick, because not
  // every browser honours the attribute. #s-release is filled in later and
  // guards its own options as it builds them.
  $$('#s-desktop option, #s-lang option, #s-gpu option, #s-kernel option, ' +
     '#s-apps option, #s-system option, #s-pin option, ' +
     '#s-bootloader option').forEach(keep);
  renderEditor();
  await loadReleases();
  await loadStarter();
  selectKind(state.kind);
  guardIdentifiers(document.body);
})();

/* ---------------------------------------------------------------- search */

let searchTimer;
$('#q').addEventListener('input', () => {
  // Typing takes over from a category, so the dropdown stops claiming it.
  $('#s-apps').value = '';
  $('#appshint').hidden = true;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 140);
});
$('#only-supported').addEventListener('change', runSearch);

function selectKind(kind) {
  state.kind = kind;
  $$('#pane-catalog .tab').forEach(x =>
    x.setAttribute('aria-selected', String(x.dataset.kind === kind)));

  const setup = kind === 'setup';
  $('.searchwrap').hidden = setup;
  $('#results').hidden = setup;
  $('#setup').hidden = !setup;
  // the output pane follows the tab you are on
  showFile(setup ? 'configuration.nix' : 'generated.nix');
  if (setup) return;

  $('#filterline').style.display = kind === 'options' ? '' : 'none';
  $('#presetline').style.display = kind === 'options' ? '' : 'none';
  $('#langline').style.display = kind === 'options' ? '' : 'none';
  $('#gpuline').style.display = kind === 'options' ? '' : 'none';
  $('#appsline').style.display = kind === 'packages' ? '' : 'none';
  // Leaving the tab drops the category, so the dropdown never claims to be
  // describing a list that has since been replaced by a search.
  $('#s-apps').value = '';
  $('#appshint').hidden = true;
  $('#q').placeholder = kind === 'options'
    ? 'openssh, firewall, timeZone…'
    : 'firefox, ripgrep, obsidian…';
  runSearch();
}

$$('#pane-catalog .tab').forEach(t =>
  t.addEventListener('click', () => selectKind(t.dataset.kind)));

/* ---------------------------------------------------------- starter files */

let starterTimer;
function onSetupChange() {
  clearTimeout(starterTimer);
  starterTimer = setTimeout(loadStarter, 200);
}
/* ---------------------------------------------------------------- releases */

async function loadReleases() {
  const r = await fetch('/api/releases').then(x => x.json());
  state.releases = r.channels || [];
  state.indexed = r.indexed;
  state.built = r.built || [];
  state.unstable = r.unstable || 'nixos-unstable';
  state.snapshot = r.snapshot || null;
  state.ageDays = r.age_days;
  state.stale = !!r.stale;
  state.releaseOf = r.release_of || {};
  state.unused = r.unused || [];

  const sel = $('#s-release');
  sel.innerHTML = '';
  state.releases.forEach(ch => {
    // The first numbered release is the current one; unstable is not a
    // release at all, so it gets said rather than left to be inferred. The
    // channel name is an identifier and the tag is prose, so the tag carries
    // its Japanese like every other option in this form. Both halves have to
    // fit the closed box — 300px — or the one that matters is the one cut off.
    const tag = ch === state.unstable ? ' (daily) — 毎日変わります'
              : ch === state.releases[0] ? ' (current) — 最新の安定版' : '';
    const o = keep(el('option', null, ch + tag));
    o.value = ch;
    sel.appendChild(o);
  });
  sel.value = state.indexed && state.releases.includes(state.indexed)
    ? state.indexed : state.releases[0];
  syncRelease();
  syncUnused();
}

/* Indexes for channels that are no longer on the list. Rebuilding a channel
   replaces its database rather than adding one, so this does not grow with
   use — it grows by one file, about 37 MB, for each channel that has ever
   been picked and has since dropped off. Nothing else would ever remove them,
   and until now nothing said they were there. */
function syncUnused() {
  const note = $('#s-unused');
  const btn = $('#btn-prune');
  const list = state.unused || [];
  note.textContent = '';
  if (!list.length) { note.hidden = true; btn.hidden = true; return; }

  const mb = Math.round(list.reduce((n, u) => n + u.bytes, 0) / 1e6);
  const many = list.length > 1;
  note.hidden = false;
  note.append(many ? `${list.length} indexes are left over: ` : 'One index is left over: ');
  list.forEach((u, i) => {
    if (i) note.append(i === list.length - 1 ? ' and ' : ', ');
    note.append(ident(u.channel));
  });
  note.append(`, taking ${mb} MB. Nothing here can select ${many ? 'them' : 'it'} ` +
              `any more, and rebuilding is all it takes to get ${many ? 'them' : 'it'} back.`);
  btn.hidden = false;
  btn.textContent = `Remove ${many ? 'them' : 'it'} (${mb} MB)`;
}

$('#btn-prune').addEventListener('click', async () => {
  const btn = $('#btn-prune');
  btn.disabled = true;
  const channels = (state.unused || []).map(u => u.channel);
  const r = await fetch('/api/indexes/remove', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channels }),
  }).then(x => x.json());
  btn.disabled = false;
  if (r.error) { showProgress('failed', r.error); return; }
  await loadReleases();
  showProgress('done',
    `Removed ${r.removed.length} index${r.removed.length > 1 ? 'es' : ''}, ` +
    `freeing ${Math.round(r.bytes / 1e6)} MB.`);
});

/* How old the option list is. On a numbered release this is background; on
   unstable the channel has moved on by tomorrow, and an option list nobody
   knows the age of is the reason unstable was unsupported for so long. */
function ageNote() {
  const frag = document.createDocumentFragment();
  if (state.ageDays == null) return frag;
  const d = state.ageDays;
  const when = d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  frag.append(` The list was published ${when}.`);
  return frag;
}

/* What flake.nix will name for a release: the exact commit the option index was
   built from when that is known, the branch when it is not. The commit is an
   identifier, so it goes through ident() rather than into a template string.

   `state.starter` lags a release change by one debounce, so its channel is
   checked — labelling nixos-25.11 with the nixos-26.05 commit would be worse
   than saying nothing. */
function pinPhrase(channel, willPin) {
  const frag = document.createDocumentFragment();
  const rev = channel === state.starter.channel ? state.starter.revision : null;
  if (rev) {
    frag.append(willPin ? 'flake.nix will pin commit ' : 'flake.nix pins commit ');
    frag.append(ident(rev.slice(0, 12)));
  } else {
    frag.append(willPin ? 'flake.nix will follow the ' : 'flake.nix follows the ');
    frag.append(ident(channel));
    frag.append(' branch');
  }
  return frag;
}

/* A commit is not always there to be had: an index built before nixgen started
   recording one, or a release whose channel server cannot be reached. The
   generated file says which of the four cases it is; this says the same thing
   where the choice was made, because a request for a commit that quietly came
   back as a branch would otherwise look like it had been honoured. */
function syncPin() {
  const note = $('#s-pin-note');
  note.textContent = '';
  if ($('#s-pin').value === 'branch') {
    // The same choice, with very different stakes: a numbered release drifts
    // over months, unstable is a different tree tomorrow.
    const daily = $('#s-release').value === state.unstable;
    note.className = daily ? 'warn' : 'note';
    note.append(daily
      ? 'flake.lock pins your first build, but unstable is a different tree by ' +
        'tomorrow — the options on the left and what you build drift apart ' +
        'within days. The commit is what holds them together.'
      : 'flake.lock still pins your first build, so it can be repeated. But the ' +
        'branch moves on, and a setting you picked here may not be in what you ' +
        'build later.');
    return;
  }
  if (state.starter.revision) {
    note.className = 'note';
    note.append('What you were offered and what you build are the same tree. ' +
                'This is the safer of the two.');
    return;
  }
  note.className = 'warn';
  note.append('No commit was available, so flake.nix names the branch instead. ' +
              'Building the index for this release records one.');
}

/* The flake follows one channel; the options you are picking from come from the
   index. Letting those drift apart would offer settings the channel does not
   have, so say so and offer to line them up.

   Two ways they drift. The obvious one is picking a channel the index was not
   built from. The other is time: the index stays where it was while the
   channel moves, which takes weeks on a numbered release and one day on
   unstable — the whole reason unstable needed this before it could be offered
   at all. */
function syncRelease() {
  const want = $('#s-release').value;
  const note = $('#s-release-note');
  const btn = $('#btn-reindex');
  note.textContent = '';
  // No selector yet — the release list is fetched, so it can fail.
  if (!want) { btn.hidden = true; return; }
  if (want === state.indexed) {
    note.className = state.stale ? 'warn' : 'note';
    note.append('The options on the left come from this channel. ');
    note.append(pinPhrase(want, false));
    note.append('.');
    note.append(ageNote());
    if (state.stale) {
      note.append(want === state.unstable
        ? ' Unstable has moved since; rebuild before trusting the list.'
        : ' Worth rebuilding.');
    }
    btn.hidden = !state.stale;
    btn.textContent = `Rebuild the ${want} index`;
    return;
  }
  note.className = 'note';
  const ready = state.built.includes(want);
  note.append(pinPhrase(want, true));
  note.append(', but the options on the left are still from ');
  note.append(ident(state.indexed));
  note.append('.');
  btn.hidden = false;
  btn.textContent = ready
    ? `Switch the options to ${want}`
    : `Build the ${want} index (a few minutes)`;
}

$('#s-release').addEventListener('change', () => {
  const want = $('#s-release').value;
  // Follow the channel that was picked, not the one the index came from: the
  // two can differ for as long as it takes to build an index, and a
  // stateVersion from the wrong one is a bad answer with no visible cause.
  setStateVersion(state.releaseOf[want], want);
  syncRelease();
  onSetupChange();
});

$('#btn-reindex').addEventListener('click', async () => {
  const channel = $('#s-release').value;
  const btn = $('#btn-reindex');
  btn.disabled = true;
  // Rebuilding the channel already in use means fetching again; without
  // `refresh` the server would see a database and simply switch to it, which
  // on a channel that moves is the one thing that would not help.
  const refresh = channel === state.indexed;
  const r = await fetch('/api/reindex', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, refresh }),
  }).then(x => x.json());
  if (r.error) { showProgress('failed', r.error); btn.disabled = false; return; }
  if (r.switched) { await afterReindex(); btn.disabled = false; return; }
  pollReindex();
});

function showProgress(stateName, message) {
  const p = $('#s-release-progress');
  p.hidden = !message;
  p.textContent = message;
  p.style.color = stateName === 'failed' ? '#9a3b3b' : 'var(--ink-soft)';
}

async function pollReindex() {
  const s = await fetch('/api/reindex/status').then(x => x.json());
  showProgress(s.state, s.message);
  if (s.state === 'fetching' || s.state === 'indexing' || s.state === 'starting') {
    setTimeout(pollReindex, 1500);
    return;
  }
  $('#btn-reindex').disabled = false;
  if (s.state === 'done') await afterReindex();
}

async function afterReindex() {
  const meta = await fetch('/api/meta').then(r => r.json());
  state.channel = meta.channel || state.channel;
  $('#channel').textContent = state.channel;
  $('#counts').textContent =
    `${(+meta.option_count).toLocaleString()} options · ` +
    `${(+meta.package_count).toLocaleString()} packages · build ${BUILD}`;
  setStateVersion(meta.release, meta.channel);
  await loadReleases();
  showProgress('done', `Options now come from ${state.channel}.`);
  runSearch();
  loadStarter();
}

const SETUP_FIELDS = ['s-host', 's-user', 's-system', 's-bootloader',
  's-grub-device', 's-networkmanager', 's-flakes', 's-make-user',
  's-groups', 's-state', 's-pin'];
SETUP_FIELDS.forEach(id => {
  const n = $('#' + id);
  n.addEventListener('input', onSetupChange);
  n.addEventListener('change', onSetupChange);
});
// Once it has been typed in, it stays typed in: switching channel must not
// quietly rewrite a stateVersion someone chose on purpose.
$('#s-state').addEventListener('input', () => { state.stateTouched = true; });

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
    channel: $('#s-release').value,
    pin: $('#s-pin').value,
  });
  state.starter = await fetch('/api/starter?' + q).then(r => r.json());
  state.starterDefines = new Set(state.starter.defines || []);
  // Both notes name what flake.nix ended up with, which is only known once the
  // server has answered.
  syncRelease();
  syncPin();
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

/* A desktop is three settings, and their names have already moved once in a
   way nobody would guess: gdm and sddm left `services.xserver`, lightdm did
   not; gnome and plasma6 left it, xfce did not; plasma5 is gone entirely. That
   is what makes it worth a shortcut — and why each role lists candidates and
   takes the first the catalogue actually has, instead of a hard-coded path
   that will move again. Nothing is invented: these are the settings the NixOS
   manual lists, added as ordinary options you can read and change. */
const DESKTOPS = {
  gnome: { label: 'GNOME', roles: [
    ['services.xserver.enable'],
    ['services.displayManager.gdm.enable',
     'services.xserver.displayManager.gdm.enable'],
    ['services.desktopManager.gnome.enable',
     'services.xserver.desktopManager.gnome.enable'],
  ] },
  plasma: { label: 'KDE Plasma', roles: [
    ['services.xserver.enable'],
    ['services.displayManager.sddm.enable',
     'services.xserver.displayManager.sddm.enable'],
    ['services.desktopManager.plasma6.enable',
     'services.desktopManager.plasma5.enable',
     'services.xserver.desktopManager.plasma5.enable'],
  ] },
  xfce: { label: 'Xfce', roles: [
    ['services.xserver.enable'],
    ['services.displayManager.lightdm.enable',
     'services.xserver.displayManager.lightdm.enable'],
    ['services.desktopManager.xfce.enable',
     'services.xserver.desktopManager.xfce.enable'],
  ] },
};

/* Add the first of `paths` that this channel actually has, and put `value` in
   it. A nullable option wants its value wrapped the way the form holds it;
   a raw one takes Nix source, so its caller passes quotes. Returns the path
   used, or null when the channel has none of them. */
async function addWithValue(paths, value) {
  for (const path of paths) {
    await addOption(path);            // a no-op when the catalogue lacks it
    if (!state.selected.has(path)) continue;
    const entry = state.selected.get(path);
    if (value !== undefined) {
      entry.value = entry.type.kind === 'nullable' ? { __null: false, v: value } : value;
    }
    return path;
  }
  return null;
}

async function addDesktop(key) {
  const d = DESKTOPS[key];
  if (!d) return;
  const added = [], missing = [];
  for (const candidates of d.roles) {
    const used = await addWithValue(candidates, true);
    used ? added.push(used) : missing.push(candidates[0]);
  }
  renderEditor();
  pushRender();
  if (missing.length) {
    setStatus(`${d.label}: added ${added.length}, but this release has no ` +
              `${missing.join(', ')}. Check the result before applying it.`, 'bad');
  } else {
    setStatus(`${d.label}: ${added.length} settings added. Change or remove ` +
              `any of them like the rest.`, 'ok');
  }
}

$('#btn-desktop').addEventListener('click', () => {
  const key = $('#s-desktop').value;
  if (key) addDesktop(key);
});

/* A language is not one setting. It is the locale, the keymap the console
   uses, the layout X uses, and — for Japanese, Korean and Chinese — an input
   method, because none of those can be typed without one.

   Fonts are deliberately not here. `fonts.packages` is a `list of absolute
   path`, so the form would write `[ "noto-fonts-cjk-sans" ]` — a string where
   a package belongs, which fails at evaluation. It does not matter: GNOME,
   Plasma and Xfce all bring noto-fonts-cjk-sans, -serif and -color-emoji
   already, which was checked rather than assumed.

   The layout is the country's, not the language's, and stops at what the
   keyboard does. Nothing here guesses a time zone from a language. */
const LANGUAGES = {
  en: { label: 'English',  locale: 'en_US.UTF-8', keyMap: 'us',     xkb: 'us' },
  ja: { label: 'Japanese', locale: 'ja_JP.UTF-8', keyMap: 'jp106',  xkb: 'jp',
        im: 'fcitx5', addons: ['fcitx5-mozc'] },
  fr: { label: 'French',   locale: 'fr_FR.UTF-8', keyMap: 'fr',     xkb: 'fr' },
  de: { label: 'German',   locale: 'de_DE.UTF-8', keyMap: 'de',     xkb: 'de' },
  es: { label: 'Spanish',  locale: 'es_ES.UTF-8', keyMap: 'es',     xkb: 'es' },
  ko: { label: 'Korean',   locale: 'ko_KR.UTF-8', keyMap: 'us',     xkb: 'kr',
        im: 'fcitx5', addons: ['fcitx5-hangul'] },
  zh: { label: 'Chinese',  locale: 'zh_CN.UTF-8', keyMap: 'us',     xkb: 'us',
        im: 'fcitx5', addons: ['fcitx5-rime'] },
};

async function addLanguage(key) {
  const L = LANGUAGES[key];
  if (!L) return;
  const steps = [
    { paths: ['i18n.defaultLocale'], value: L.locale },
    // console.keyMap is a union, so the form holds it as Nix source.
    { paths: ['console.keyMap'], value: JSON.stringify(L.keyMap) },
    { paths: ['services.xserver.xkb.layout', 'services.xserver.layout'],
      value: L.xkb },
  ];
  if (L.im) steps.push(
    { paths: ['i18n.inputMethod.enable'], value: true },
    { paths: ['i18n.inputMethod.type', 'i18n.inputMethod.enabled'], value: L.im },
    { paths: ['i18n.inputMethod.fcitx5.addons'], value: L.addons });

  const added = [], missing = [];
  for (const step of steps) {
    const used = await addWithValue(step.paths, step.value);
    used ? added.push(used) : missing.push(step.paths[0]);
  }
  renderEditor();
  pushRender();
  const tail = L.im
    ? ' fcitx5 is set up for typing it; the CJK fonts come with the desktop.'
    : '';
  if (missing.length) {
    setStatus(`${L.label}: added ${added.length}, but this release has no ` +
              `${missing.join(', ')}. Check the result before applying it.`, 'bad');
  } else {
    setStatus(`${L.label}: ${added.length} settings added.${tail}`, 'ok');
  }
}

$('#btn-lang').addEventListener('click', () => {
  const key = $('#s-lang').value;
  if (key) addLanguage(key);
});

/* Graphics. `hardware.graphics.enable` is the part every card needs, and
   enable32Bit is what makes Steam and wine work, so both go in whatever you
   pick.

   `services.xserver.videoDrivers` is set for NVIDIA only, and that is not an
   oversight. The default is `modesetting`, which is the right answer for AMD
   and Intel on any current kernel; forcing the amdgpu DDX instead is a change
   with no upside and a history of regressions. NVIDIA is the one card whose
   X driver genuinely has to be named.

   Intel gets a VAAPI driver because hardware video decoding does not work
   without one. AMD does not need it — mesa carries radeonsi — and NVIDIA's
   is left out, since it only pays off with a browser configured to use it.

   `hardware.nvidia.open` is set explicitly rather than left to its computed
   default: `false` is the proprietary kernel module, which works on every
   card the driver supports. `true` is faster to say and wrong on anything
   before Turing. */
const GPUS = {
  amd: { label: 'AMD', extras: [] },
  intel: { label: 'Intel', extras: ['intel-media-driver'] },
  nvidia: { label: 'NVIDIA', extras: [], drivers: ['nvidia'],
            nvidia: true },
};

async function addGpu(key) {
  const g = GPUS[key];
  if (!g) return;
  const steps = [
    { paths: ['hardware.graphics.enable', 'hardware.opengl.enable'], value: true },
    { paths: ['hardware.graphics.enable32Bit', 'hardware.opengl.driSupport32Bit'],
      value: true },
  ];
  if (g.extras.length) {
    steps.push({ paths: ['hardware.graphics.extraPackages'], value: g.extras });
  }
  if (g.drivers) {
    steps.push({ paths: ['services.xserver.videoDrivers'], value: g.drivers });
  }
  if (g.nvidia) {
    steps.push(
      { paths: ['hardware.nvidia.modesetting.enable'], value: true },
      { paths: ['hardware.nvidia.open'], value: false });
  }

  const added = [], missing = [];
  for (const step of steps) {
    const used = await addWithValue(step.paths, step.value);
    used ? added.push(used) : missing.push(step.paths[0]);
  }
  renderEditor();
  pushRender();
  // No unfree warning here on purpose — doRender raises it, and keeps
  // raising it, which a message written once from this side would not.
  if (missing.length) {
    setStatus(`${g.label}: added ${added.length}, but this release has no ` +
              `${missing.join(', ')}. Check the result before applying it.`, 'bad');
  } else {
    setStatus(`${g.label}: ${added.length} settings added.`, 'ok');
  }
}

$('#btn-gpu').addEventListener('click', () => {
  const key = $('#s-gpu').value;
  if (key) addGpu(key);
});

/* The kernel. `boot.kernelPackages` is a raw option — its value is Nix source
   rather than anything the form can hold — so this writes the expression and
   leaves it in a text box you can edit.

   Each name is looked up in the package index before it is written, the way
   the app categories are, because a kernel this channel does not have would
   otherwise be a line that fails at `nixos-rebuild` rather than here.

   LTS is a list of series, newest first, and takes the first the channel has:
   there is no `linuxPackages_lts` in nixpkgs — that was checked, not assumed —
   and the LTS series are kernel.org's designation, which nothing in the index
   records. `pkgs.linuxKernel.packages.linux_6_12` is the form the option's own
   example uses. When kernel.org names a new LTS, it goes on the front of this
   list; until then the newest one nixpkgs still ships is what comes out, and
   the status line says which version that was so a stale list is visible. */
const KERNELS = {
  standard: { label: 'Standard', try: [
    { probe: 'linux', expr: 'pkgs.linuxPackages' } ] },
  latest: { label: 'Latest', try: [
    { probe: 'linux_latest', expr: 'pkgs.linuxPackages_latest' } ] },
  lts: { label: 'LTS', try: ['6_12', '6_6', '6_1', '5_15', '5_10'].map(s => (
    { probe: `linuxKernel.kernels.linux_${s}`,
      expr: `pkgs.linuxKernel.packages.linux_${s}` })) },
  zen: { label: 'Zen', try: [
    { probe: 'linux_zen', expr: 'pkgs.linuxPackages_zen' } ] },
};

async function addKernel(key) {
  const k = KERNELS[key];
  if (!k) return;
  const url = '/api/packages?attrs=' +
    encodeURIComponent(k.try.map(c => c.probe).join(','));
  const { results } = await fetch(url).then(r => r.json());
  const have = new Map((results || []).map(r => [r.attr, r.version]));
  const pick = k.try.find(c => have.has(c.probe));
  if (!pick) {
    setStatus(`${k.label}: this channel has no ${k.try[0].probe}. ` +
              `Nothing was added.`, 'bad');
    return;
  }
  const used = await addWithValue(['boot.kernelPackages'], pick.expr);
  if (!used) {
    setStatus(`This release has no boot.kernelPackages. Nothing was added.`, 'bad');
    return;
  }
  renderEditor();
  pushRender();
  // Said for the two that move: an out-of-tree module has to be built against
  // whatever kernel is running, and the NVIDIA one is regularly a few weeks
  // behind a brand-new release. Said as `ok` rather than `todo` — doRender
  // clears a todo status when it has no notes of its own, and the render this
  // function just asked for would wipe the message on its way out.
  const tail = key === 'latest' || key === 'zen'
    ? ' Out-of-tree modules — the NVIDIA driver most of all — can lag a new ' +
      'kernel by weeks. Check with dry-build.'
    : '';
  setStatus(`${k.label}: boot.kernelPackages = ${pick.expr} — ` +
            `linux ${have.get(pick.probe)}.${tail}`, 'ok');
}

$('#btn-kernel').addEventListener('click', () => {
  const key = $('#s-kernel').value;
  if (key) addKernel(key);
});

/* A few representative packages per area, for when you know the kind of thing
   you want but not what it is called here. Every name was checked against the
   catalogue; ones nixpkgs has renamed are simply absent from the result rather
   than offered and broken — `kdenlive` is `kdePackages.kdenlive`, `0ad` is
   `zeroad`, `superTuxKart` is `supertuxkart`, and none of those are guessable.
   This is a short pick and says so on screen: it is the one place in the tool
   where somebody's taste decides what you see, so it stays small, and the
   search box remains the way to find anything else. */
const APPS = {
  browser: ['firefox', 'chromium', 'google-chrome', 'librewolf', 'brave',
            'ungoogled-chromium', 'epiphany'],
  mail:    ['thunderbird', 'evolution', 'geary', 'claws-mail'],
  office:  ['libreoffice', 'onlyoffice-desktopeditors', 'obsidian', 'gnumeric',
            'abiword', 'xournalpp', 'papers', 'kdePackages.okular',
            'gnome-calendar', 'gnome-contacts'],
  media:   ['vlc', 'mpv', 'parole', 'xfce.parole', 'showtime', 'obs-studio',
            'audacity', 'kdePackages.kdenlive', 'davinci-resolve', 'handbrake',
            'gpu-screen-recorder-gtk', 'strawberry', 'kdePackages.elisa',
            'gnome-music', 'decibels', 'snapshot', 'pavucontrol', 'ffmpeg-full'],
  graphics:['gimp', 'gimp-with-plugins', 'inkscape', 'krita', 'darktable',
            'blender', 'freecad', 'ristretto', 'xfce.ristretto', 'loupe',
            'kdePackages.gwenview', 'simple-scan', 'rawtherapee'],
  games:   ['steam', 'lutris', 'prismlauncher', 'protonup-qt', 'steam-run',
            'goverlay', 'mangohud', 'moonlight-qt', 'supertuxkart',
            'superTuxKart', 'zeroad', 'retroarch'],
  comms:   ['discord', 'signal-desktop', 'element-desktop', 'telegram-desktop',
            'dropbox', 'nextcloud-client', 'syncthing'],
  accessories: ['flameshot', 'kdePackages.spectacle', 'xfce4-screenshooter',
                'xfce.xfce4-screenshooter', 'copyq', 'gnome-calculator',
                'kdePackages.kcalc', 'galculator', 'file-roller', 'xarchiver',
                'kdePackages.ark', 'xfburn', 'xfce.xfburn', 'gnome-text-editor',
                'mousepad', 'xfce.mousepad', 'catfish', 'xfce.catfish',
                'xfce4-appfinder', 'xfce.xfce4-appfinder', 'gigolo',
                'xfce.gigolo', 'orage', 'xfce.orage', 'plank', 'gnome-clocks',
                'gnome-weather', 'gnome-maps', 'gnome-font-viewer',
                'gnome-disk-utility', 'gnome-characters'],
  files:   ['nautilus', 'kdePackages.dolphin', 'thunar', 'xfce.thunar', 'nemo',
            'pcmanfm', 'yazi', 'ranger', 'nnn', 'mc', 'doublecmd'],
  terminal:['alacritty', 'kitty', 'wezterm', 'ghostty', 'foot', 'rio',
            'kdePackages.konsole', 'gnome-console', 'xfce4-terminal',
            'xfce.xfce4-terminal', 'tilix', 'terminator'],
  system:  ['htop', 'btop', 'gnome-system-monitor',
            'kdePackages.plasma-systemmonitor', 'xfce4-taskmanager',
            'xfce.xfce4-taskmanager', 'gparted', 'keepassxc', 'seahorse',
            'kdePackages.kwalletmanager', 'baobab', 'timeshift', 'fastfetch',
            'lm_sensors', 'lshw', 'pciutils', 'kdePackages.kinfocenter',
            'gnome-logs', 'solaar', 'piper', 'remmina', 'gnome-connections',
            'virt-viewer', 'kdePackages.discover'],
  dev:     ['git', 'neovim', 'helix', 'kdePackages.kate', 'vscodium', 'gh',
            'direnv', 'tmux', 'gcc', 'clang', 'rustc', 'cargo', 'claude-code',
            'opencode', 'bash-language-server'],
};

async function showApps(key) {
  const attrs = APPS[key];
  $('#appshint').hidden = !attrs;
  if (!attrs) { runSearch(); return; }
  const url = '/api/packages?attrs=' + encodeURIComponent(attrs.join(','));
  const { results } = await fetch(url).then(r => r.json());
  paintPackages(results);
}

$('#s-apps').addEventListener('change', () => showApps($('#s-apps').value));

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

  // With nothing set, the pane is where the steps go instead — first thing
  // anyone sees, and gone the moment there is something to show. Nothing is
  // remembered between visits here, so anything needing a dismiss button
  // would ask to be dismissed every time.
  $('#howto').hidden = state.selected.size > 0;
  if (!state.selected.size) return;

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

/* Split on dots but keep <placeholders> and "quoted names" atomic — a few
   upstream option keys contain dots inside their angle brackets, and 76 hold
   a quoted name with dots of its own, `boot.kernel.sysctl."net.core.rmem_max"`
   among them. Must stay in step with _SEGMENT in nixgen_core.py. */
function segmentsFor(entry) {
  let i = 0;
  return (entry.path.match(/<[^>]*>|"[^"]*"|[^.]+/g) || []).map(seg =>
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
  /* The NVIDIA driver is unfree, and the reminder above cannot see it: that
     one watches environment.systemPackages, and this arrives through a
     module. It belongs here rather than in a one-off message from the preset,
     because a note that is regenerated on every render is one that cannot be
     wiped by the next one — which is exactly what happened when it was. */
  if (/^\s*hardware\.nvidia\./m.test(res.text)) {
    notes.push(`The NVIDIA driver is unfree. Set nixpkgs.config.allowUnfree = ` +
               `true; in your configuration.nix, or the build refuses it.`);
  }
  /* Steam runs from the package, but the module is what puts the 32-bit
     graphics drivers in place and can open the remote-play ports. Saying so
     beats leaving Steam out of the list, which only sent people looking. */
  const listed = findEntry(TOP_OPTION);
  if (listed && Array.isArray(listed.value) && listed.value.includes('steam')) {
    notes.push(`steam is listed as a package. programs.steam.enable under ` +
               `Options is the fuller way — it sets up the 32-bit graphics ` +
               `drivers, and can open the remote-play ports.`);
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
