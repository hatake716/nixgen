/* nixgen — client. Vanilla JS, no build step. */

/* Shown in the header. Bump it whenever this file changes, so "the fix did not
   work" can be told apart from "the old file is still being served". */
const BUILD = '2026-08-11a';

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
  /* What an imported configuration.nix said that no field on the Setup tab
     holds. It goes into the configuration.nix that tab writes rather than into
     the module: reading a file in and then looking at configuration.nix should
     show the same settings, which is the whole point of there being two
     imports. `carried` is entries for the renderer; `carriedImports` are the
     paths its own `imports` named, minus the two the starter writes. */
  carried: [],
  carriedImports: [],
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
  try {
    await boot();
  } catch (err) {
    /* One failed request used to end the boot sequence part-way through: the
       Setup pane is unhidden by selectKind at the end of it, so the first
       thing anyone sees was an empty column with nothing said. The usual cause
       is the server not being up yet, or a channel switch swapping the index
       underneath the page, and both are fixed by reloading — but only if you
       are told that. */
    setStatus(say(
      `Could not load from the nixgen server (${err.message}). It may still ` +
      `be starting, or busy rebuilding the index. Reload the page; if it ` +
      `keeps happening, look at the terminal it was started from.`,
      `nixgen のサーバーから読み込めませんでした(${err.message})。まだ起動中か、` +
      `インデックスの再構築中かもしれません。ページを再読み込みしてください。` +
      `繰り返す場合は、起動したターミナルの表示を確認してください。`), 'bad');
    $('#setup').hidden = false;
  }
})();

async function boot() {
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
     '#s-shell option, ' +
     '#s-apps option, #s-system option, #s-pin option, ' +
     '#s-bootloader option').forEach(keep);
  renderEditor();
  await loadReleases();
  await loadStarter();
  selectKind(state.kind);
  guardIdentifiers(document.body);
}

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

  /* Every preset line belongs to Options except the app categories, which add
     packages. Written as one rule over `.presetline` rather than one line per
     id: the id list was missed when the kernel row was added, and a row nobody
     hid showed up on the Packages tab as well, where it had no business being
     and read as a second copy of the one under Options. */
  $('#filterline').style.display = kind === 'options' ? '' : 'none';
  $$('.presetline').forEach(line => {
    const wanted = line.id === 'appsline' ? 'packages' : 'options';
    line.style.display = kind === wanted ? '' : 'none';
  });
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
  state.starter = await fetch('/api/starter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...Object.fromEntries(q),
      carried: state.carried,
      imports: state.carriedImports,
    }),
  }).then(r => r.json());
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
  $('#btn-copy').hidden = name === ALL;      // there is nothing here to paste
  $('#btn-dl-all').hidden = name === ALL;    // the button beside it says this
  paintCode(currentText());
}

async function runSearch() {
  /* A category is a list too, and repainting has to keep it. Adding the first
     package from one used to put the default listing back in its place —
     `addOption` repaints, and this function only knew about the search box —
     so picking Games and clicking Steam took the games away. */
  /* The Setup tab has no result list. Everything that changes the module
     repaints one — an import, an option a preset added — and on that tab the
     search asked for `kind=setup`, which the server answers with options,
     which then went through the package painter. It painted nothing anybody
     could see, until the painter started reading `attr` for the icon and threw
     instead, taking the rest of the import handler with it. */
  if (state.kind !== 'options' && state.kind !== 'packages') return;
  const category = state.kind === 'packages' && $('#s-apps').value;
  if (category) return showApps(category);
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

/* A tile for each package: its own icon where the machine has one, and its
   first letter where it does not.

   The icons come from the icon themes already installed — nothing is
   downloaded and nothing is added to what nixgen depends on — so how many of
   them appear depends on the machine. The letter is not a placeholder waiting
   for a better answer: `tmux` and `gcc` have no icon anywhere, and a row of
   the same grey square would be worse than a letter that at least differs
   between neighbours. The colour comes from the name, so a package sits in
   the same colour every time you look for it. */
function packageIcon(attr, hasIcon) {
  const name = attr.split('.').pop();
  let hash = 0;
  for (const ch of attr) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  const tile = el('span', 'pkgicon');
  const letter = el('span', 'letter', name[0] ? name[0].toUpperCase() : '?');
  // Decorative: it stands in for a picture, and a screen reader announcing
  // "C cosmic-term" — or a copied row carrying a stray letter — is not what
  // the tile is for.
  letter.setAttribute('aria-hidden', 'true');
  tile.style.background = `hsl(${hash}, 42%, 88%)`;
  tile.style.color = `hsl(${hash}, 38%, 32%)`;
  tile.appendChild(letter);
  // The row already says whether this machine has one. Asking anyway would
  // mean a 404 for every package that has none — a console full of failures
  // that are not failures, and a request per row that was never going to
  // arrive.
  if (!hasIcon) return tile;
  const img = el('img');
  img.loading = 'lazy';
  img.alt = '';
  img.src = '/api/icon?attr=' + encodeURIComponent(attr);
  // No icon for this one: drop the image and the letter underneath shows.
  img.addEventListener('error', () => img.remove());
  // One that did load covers the tile, so the letter and its colour go — an
  // icon on its own square looks like a badge on a badge, and the square is
  // still there under a transparent icon when the row is hovered.
  img.addEventListener('load', () => {
    tile.style.background = 'none';
    letter.hidden = true;
  });
  tile.appendChild(img);
  return tile;
}

/* Is this package already in environment.systemPackages?

   Two shapes to read: the list the form holds, and the source of one that came
   in verbatim (`with pkgs; [ … ]`). Both spellings count — under `with pkgs;`
   an element is written `vscode` and without it `pkgs.vscode`, and the same
   package written either way is still in the list. */
function alreadyListed(attr) {
  const e = findEntry(TOP_OPTION);
  if (!e) return false;
  if (Array.isArray(e.value)) return e.value.includes(attr);
  const text = String(e.value || '');
  if (!text.includes('[')) return false;
  return [attr, 'pkgs.' + attr].some(item =>
    new RegExp('(^|[\\s\\[])' + rxEscape(item) + '(?=[\\s\\]]|$)').test(text));
}

/* Grey the rows for packages that are in the list already. Done by walking the
   rows on screen rather than asking for them again: this runs after every
   render, so it has to cost nothing, and it has to cover a package removed by
   hand from the card as well as one added by clicking. */
function syncAddedRows() {
  $$('#results .row.pkg').forEach(row =>
    row.classList.toggle('added', alreadyListed(row.dataset.attr)));
}

function paintPackages(rows) {
  const box = $('#results');
  box.innerHTML = '';
  if (!rows.length) { box.appendChild(el('div', 'empty', 'No package matches that.')); return; }
  rows.forEach(r => {
    const b = el('button', 'row pkg' + (alreadyListed(r.attr) ? ' added' : ''));
    b.dataset.attr = r.attr;
    b.appendChild(packageIcon(r.attr, r.icon));
    const text = el('div', 'rowtext');
    const p = el('div', 'p');
    p.appendChild(ident(r.attr));
    if (r.unfree) p.appendChild(el('span', 'badge unfree', 'unfree'));
    if (r.broken) p.appendChild(el('span', 'badge broken', 'broken'));
    text.appendChild(p);
    if (r.description) text.appendChild(el('div', 'd', r.description));
    text.appendChild(ident(r.version || '', 't'));
    b.appendChild(text);
    // A greyed row is not a dead one: clicking it takes you to the card the
    // package is already in, the way clicking an option you have flashes its
    // card rather than adding a second.
    b.addEventListener('click', () => alreadyListed(r.attr)
      ? flashCard(TOP_OPTION)
      : addPackage(r.attr, r.unfree));
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

/* Put a card on screen for an option the catalogue has already handed over.
   Split out from addOption so a caller that looked several paths up at once
   does not have to ask for the winner a second time. */
function placeOption(path, opt) {
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

async function addOption(path) {
  if (state.selected.has(path)) { flashCard(path); return; }
  const opt = await fetch('/api/option?path=' + encodeURIComponent(path)).then(r => r.json());
  if (opt.error) return;
  placeOption(path, opt);
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
  // Cinnamon has not moved out of services.xserver, the way xfce has not.
  // lightdm is the greeter it is normally paired with.
  cinnamon: { label: 'Cinnamon', roles: [
    ['services.xserver.enable'],
    ['services.displayManager.lightdm.enable',
     'services.xserver.displayManager.lightdm.enable'],
    ['services.desktopManager.cinnamon.enable',
     'services.xserver.desktopManager.cinnamon.enable'],
  ] },
  /* COSMIC is Wayland, and its two options are the only two: no
     `services.xserver.enable` here, which is not an omission — turning X on
     for a desktop that does not use it builds an X server nothing runs. It
     brings its own greeter, which is why sddm and lightdm are not offered
     either. */
  cosmic: { label: 'COSMIC', roles: [
    ['services.displayManager.cosmic-greeter.enable'],
    ['services.desktopManager.cosmic.enable'],
  ] },
  // LXQt is X11 and, like xfce and cinnamon, never left services.xserver.
  // sddm is the greeter its own documentation pairs it with.
  lxqt: { label: 'LXQt', roles: [
    ['services.xserver.enable'],
    ['services.displayManager.sddm.enable',
     'services.xserver.displayManager.sddm.enable'],
    ['services.desktopManager.lxqt.enable',
     'services.xserver.desktopManager.lxqt.enable'],
  ] },
  /* i3 is a window manager rather than a desktop: X, a greeter, and i3 on top
     — and nothing else, because what a tiling setup looks like is the user's
     to write. It comes up with an empty screen and its own first-run wizard. */
  i3: { label: 'i3', roles: [
    ['services.xserver.enable'],
    ['services.displayManager.lightdm.enable',
     'services.xserver.displayManager.lightdm.enable'],
    ['services.xserver.windowManager.i3.enable'],
  ],
    note: 'i3 starts with an empty screen and asks to write a config on first ' +
          'run. There is no X to turn off here — it needs one — but nothing ' +
          'else was assumed.',
    note_ja: 'i3 は何も無い画面で起動し、初回に設定ファイルを作るか尋ねてきます。' +
             'X は必要なのでそのまま入れていますが、それ以外は何も決めていません。' },
  /* The three Wayland compositors: no X server — turning one on for a desktop
     that does not use it builds an X server nothing runs — and sddm in Wayland
     mode as the greeter. None of them ships one, and a machine that boots to a
     text console is not what most people mean by "pick a desktop", so the
     greeter goes in and the card is there to delete. `wayland.enable` is the
     half that matters, and the two configs were built to see the difference:
     with it, sddm's own config says `DisplayServer=wayland` and the greeter
     runs under weston; without it, `DisplayServer=x11` — an X11 login screen
     in front of a machine that has no X server for anything else. */
  hyprland: { label: 'Hyprland', roles: [
    ['programs.hyprland.enable'],
    ['programs.hyprland.xwayland.enable'],
    ['services.displayManager.sddm.enable',
     'services.xserver.displayManager.sddm.enable'],
    ['services.displayManager.sddm.wayland.enable'],
  ],
    packages: ['noctalia-shell'],
    note: 'sddm goes in with it, in Wayland mode, so the machine boots to a ' +
          'login screen with Hyprland in the session list, and XWayland is ' +
          'switched on for X11 applications — that one is the default anyway, ' +
          'and is here so the card says which way it is set. Delete any of ' +
          'them if you start from a text console or use greetd instead.',
    note_ja: 'ログイン画面として sddm を Wayland モードで入れてあります。' +
             '起動するとログイン画面が出て、セッション一覧に Hyprland が' +
             '並びます。X11 のアプリ用に XWayland も有効にしました。これは' +
             '元々の既定値でもありますが、どちらに設定されているかがカードで' +
             '分かるように明示しています。テキストコンソールから起動する場合や ' +
             'greetd を使う場合は、該当のカードを削除してください。' },
  /* A compositor is a compositor and nothing else — no panel, no launcher, no
     notifications — so all three Wayland ones bring noctalia-shell, which is
     the piece that puts those on top. It is a package rather than a setting:
     nothing in the option catalogue mentions it. Added as an ordinary line in
     environment.systemPackages, which the status bar says and the card shows,
     so it can be taken out like anything else. */
  niri: { label: 'niri', roles: [
    ['programs.niri.enable'],
    ['services.displayManager.sddm.enable',
     'services.xserver.displayManager.sddm.enable'],
    ['services.displayManager.sddm.wayland.enable'],
  ],
    packages: ['noctalia-shell', 'xwayland-satellite'],
    note: 'sddm goes in with it, in Wayland mode, so the machine boots to a ' +
          'login screen with niri in the session list. niri has no XWayland ' +
          'option — it does not carry one — so xwayland-satellite goes in as ' +
          'a package, and your niri config has to spawn it for X11 ' +
          'applications to find a display.',
    note_ja: 'ログイン画面として sddm を Wayland モードで入れてあります。' +
             '起動するとログイン画面が出て、セッション一覧に niri が並びます。' +
             'niri には XWayland のオプションがありません(内蔵していません)。' +
             'そのため xwayland-satellite をパッケージとして入れてあります。' +
             'X11 のアプリから見えるようにするには、niri の設定ファイルから' +
             'これを起動してください。' },
  sway: { label: 'Sway', roles: [
    ['programs.sway.enable'],
    ['programs.sway.xwayland.enable'],
    ['services.displayManager.sddm.enable',
     'services.xserver.displayManager.sddm.enable'],
    ['services.displayManager.sddm.wayland.enable'],
  ],
    packages: ['noctalia-shell'],
    note: 'sddm goes in with it, in Wayland mode, so the machine boots to a ' +
          'login screen with Sway in the session list, and XWayland is ' +
          'switched on for X11 applications — that one is the default anyway, ' +
          'and is here so the card says which way it is set. Delete any of ' +
          'them if you start from a text console or use greetd instead.',
    note_ja: 'ログイン画面として sddm を Wayland モードで入れてあります。' +
             '起動するとログイン画面が出て、セッション一覧に Sway が並びます。' +
             'X11 のアプリ用に XWayland も有効にしました。これは元々の既定値' +
             'でもありますが、どちらに設定されているかがカードで分かるように' +
             '明示しています。テキストコンソールから起動する場合や greetd を' +
             '使う場合は、該当のカードを削除してください。' },
};

/* Add the first of `paths` that this channel actually has, and put `value` in
   it. A nullable option wants its value wrapped the way the form holds it;
   a raw one takes Nix source, so its caller passes quotes. Returns the path
   used, or null when the channel has none of them. */
async function addWithValue(paths, value) {
  /* One question with every spelling in it, rather than one request per
     candidate: asking for each in turn meant a 404 for every name this
     release does not use, and those are ordinary — `lightdm` never left
     `services.xserver` while `gdm` did. What comes back is the ones that
     exist, in the order asked, so the first is the one to use. */
  const url = '/api/options?paths=' + encodeURIComponent(paths.join(','));
  const { results } = await fetch(url).then(r => r.json());
  const opt = (results || [])[0];
  if (!opt) return null;
  const path = opt.path;
  if (state.selected.has(path)) flashCard(path);
  else placeOption(path, opt);
  const entry = state.selected.get(path);
  if (value !== undefined) {
    entry.value = entry.type.kind === 'nullable' ? { __null: false, v: value } : value;
  }
  return path;
}

async function addDesktop(key) {
  const d = DESKTOPS[key];
  if (!d) return;
  const added = [], missing = [];
  for (const candidates of d.roles) {
    const used = await addWithValue(candidates, true);
    used ? added.push(used) : missing.push(candidates[0]);
  }
  /* A desktop that needs a package as well as its settings. Looked up rather
     than written, the way the app categories are: a name this channel does not
     have is absent from the answer and therefore from the file, instead of
     arriving as a line that fails at nixos-rebuild. */
  const pkgs = [];
  if (d.packages && d.packages.length) {
    const url = '/api/packages?attrs=' + encodeURIComponent(d.packages.join(','));
    const { results } = await fetch(url).then(r => r.json());
    for (const row of results || []) {
      await addPackage(row.attr, row.unfree);
      pkgs.push(row.attr);
    }
    d.packages.filter(a => !pkgs.includes(a)).forEach(a => missing.push(a));
  }
  renderEditor();
  pushRender();
  if (missing.length) {
    setStatus(say(
      `${d.label}: added ${added.length}, but this release has no ` +
      `${missing.join(', ')}. Check the result before applying it.`,
      `${d.label}: ${added.length}件を追加しましたが、このリリースには ` +
      `${missing.join('、')} がありません。適用する前に結果を確認してください。`), 'bad');
  } else {
    const extra = pkgs.length
      ? ` ${pkgs.join(', ')} went into environment.systemPackages with it.` : '';
    const extraJa = pkgs.length
      ? `あわせて ${pkgs.join('、')} を environment.systemPackages に入れました。` : '';
    setStatus(say(
      `${d.label}: ${added.length} settings added. Change or remove any of ` +
      `them like the rest.` + extra + (d.note ? ' ' + d.note : ''),
      `${d.label}: ${added.length}件の設定を追加しました。他の項目と同じように、` +
      `変更も削除もできます。` + extraJa + (d.note_ja ? d.note_ja : '')), 'ok');
  }
}

/* A shell is two settings, and the one people forget is the module.

   `users.defaultUserShell` alone gives every account a shell that is not in
   /etc/shells and has no completions installed — the login works and nothing
   else quite does. `programs.zsh.enable` and `programs.fish.enable` are what
   register it properly, so they go in together.

   That option is `absolute path or package`, which the form holds as Nix
   source, so what is written is `pkgs.fish` rather than a package widget.
   Bash gets `bashInteractive`: `pkgs.bash` is the build without readline, and
   handing somebody that as their login shell is a bad afternoon. */
const SHELLS = {
  bash: { label: 'bash', pkg: 'pkgs.bashInteractive' },
  zsh:  { label: 'zsh',  pkg: 'pkgs.zsh',  module: 'programs.zsh.enable' },
  fish: { label: 'fish', pkg: 'pkgs.fish', module: 'programs.fish.enable' },
};

async function addShell(key) {
  const sh = SHELLS[key];
  if (!sh) return;
  const steps = [];
  if (sh.module) steps.push({ paths: [sh.module], value: true });
  steps.push({ paths: ['users.defaultUserShell'], value: sh.pkg });

  const added = [], missing = [];
  for (const step of steps) {
    const used = await addWithValue(step.paths, step.value);
    used ? added.push(used) : missing.push(step.paths[0]);
  }
  renderEditor();
  pushRender();
  if (missing.length) {
    setStatus(say(
      `${sh.label}: added ${added.length}, but this release has no ` +
      `${missing.join(', ')}. Check the result before applying it.`,
      `${sh.label}: ${added.length}件を追加しましたが、このリリースには ` +
      `${missing.join('、')} がありません。適用する前に結果を確認してください。`), 'bad');
    return;
  }
  setStatus(say(
    `${sh.label}: ${added.length} settings added. users.defaultUserShell is ` +
    `every normal account on the machine — for one user only, search for ` +
    `users.users.<name>.shell instead.`,
    `${sh.label}: ${added.length}件の設定を追加しました。users.defaultUserShell は` +
    `このマシンの通常アカウント全部に効きます。1人だけ変えたい場合は、` +
    `users.users.<name>.shell を検索してください。`), 'ok');
}

$('#btn-shell').addEventListener('click', () => {
  const key = $('#s-shell').value;
  if (key) addShell(key);
});

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
  const tailJa = L.im
    ? ' 入力には fcitx5 を設定しました。CJKフォントはデスクトップが持っています。'
    : '';
  if (missing.length) {
    setStatus(say(
      `${L.label}: added ${added.length}, but this release has no ` +
      `${missing.join(', ')}. Check the result before applying it.`,
      `${L.label}: ${added.length}件を追加しましたが、このリリースには ` +
      `${missing.join('、')} がありません。適用する前に結果を確認してください。`), 'bad');
  } else {
    setStatus(say(`${L.label}: ${added.length} settings added.${tail}`,
                  `${L.label}: ${added.length}件の設定を追加しました。${tailJa}`), 'ok');
  }
}

/* Flatpak is three settings and one command.

   `services.flatpak.enable` on its own installs it and starts nothing you can
   use: a Flatpak application talks to the outside through an xdg portal, so
   without one it opens with no file dialog and no screen sharing. GNOME and
   Plasma bring their own backend, which is why the GTK one goes in as well
   rather than instead — it is the fallback for the desktops that do not, and
   an extra backend on a desktop that has one is a card you can delete.

   The command is the part no option covers: a fresh install has no remote, so
   `flatpak install` finds nothing until flathub is added once, by hand. That
   is said in the status bar rather than left to be discovered. */
async function addFlatpak() {
  const steps = [
    { paths: ['services.flatpak.enable'], value: true },
    { paths: ['xdg.portal.enable'], value: true },
    { paths: ['xdg.portal.extraPortals'], value: ['xdg-desktop-portal-gtk'] },
  ];
  const added = [], missing = [];
  for (const step of steps) {
    const used = await addWithValue(step.paths, step.value);
    used ? added.push(used) : missing.push(step.paths[0]);
  }
  renderEditor();
  pushRender();
  if (missing.length) {
    setStatus(say(
      `Flatpak: added ${added.length}, but this release has no ` +
      `${missing.join(', ')}. Check the result before applying it.`,
      `Flatpak: ${added.length}件を追加しましたが、このリリースには ` +
      `${missing.join('、')} がありません。適用する前に結果を確認してください。`), 'bad');
    return;
  }
  setStatus(say(
    'Flatpak: 3 settings added. Nothing is installed from it yet — a fresh ' +
    'install has no remote, so add flathub once after the rebuild: ' +
    'flatpak remote-add --if-not-exists flathub ' +
    'https://flathub.org/repo/flathub.flatpakrepo',
    'Flatpak: 3件の設定を追加しました。まだ何も入れられません。' +
    'インストール直後はリモートが1つも無いので、rebuild のあとに flathub を' +
    '一度だけ追加してください: flatpak remote-add --if-not-exists flathub ' +
    'https://flathub.org/repo/flathub.flatpakrepo'), 'ok');
}

$('#btn-flatpak').addEventListener('click', addFlatpak);

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
    setStatus(say(
      `${g.label}: added ${added.length}, but this release has no ` +
      `${missing.join(', ')}. Check the result before applying it.`,
      `${g.label}: ${added.length}件を追加しましたが、このリリースには ` +
      `${missing.join('、')} がありません。適用する前に結果を確認してください。`), 'bad');
  } else {
    setStatus(say(`${g.label}: ${added.length} settings added.`,
                  `${g.label}: ${added.length}件の設定を追加しました。`), 'ok');
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
    setStatus(say(
      `${k.label}: this channel has no ${k.try[0].probe}. Nothing was added.`,
      `${k.label}: このチャンネルには ${k.try[0].probe} がありません。` +
      `何も追加していません。`), 'bad');
    return;
  }
  const used = await addWithValue(['boot.kernelPackages'], pick.expr);
  if (!used) {
    setStatus(say(
      'This release has no boot.kernelPackages. Nothing was added.',
      'このリリースには boot.kernelPackages がありません。何も追加していません。'),
      'bad');
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
  const tailJa = key === 'latest' || key === 'zen'
    ? 'カーネル外のモジュール(とりわけ NVIDIA のドライバ)は、新しいカーネルに' +
      '数週間遅れることがあります。dry-build で確かめてください。'
    : '';
  setStatus(say(
    `${k.label}: boot.kernelPackages = ${pick.expr} — ` +
    `linux ${have.get(pick.probe)}.${tail}`,
    `${k.label}: boot.kernelPackages = ${pick.expr} — ` +
    `linux ${have.get(pick.probe)} です。${tailJa}`), 'ok');
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
   search box remains the way to find anything else.

   The five desktops' own apps are here so they can be taken apart from the
   desktop, which is also the line for what gets left out: `cosmic-settings`
   and `cosmic-launcher` are nothing without COSMIC running, and the mint and
   cinnamon-* packages are the desktop itself. Two more were dropped for a
   duller reason — `nemo-with-extensions` and `evolutionWithPlugins` are
   wrappers the catalogue holds no description or version for, so they would
   arrive as blank rows, and plain `nemo` and `evolution` are already here. */
const APPS = {
  browser: ['firefox', 'chromium', 'google-chrome', 'librewolf', 'brave',
            'ungoogled-chromium', 'epiphany'],
  mail:    ['thunderbird', 'evolution', 'geary', 'claws-mail'],
  office:  ['libreoffice', 'onlyoffice-desktopeditors', 'obsidian', 'gnumeric',
            'abiword', 'xournalpp', 'papers', 'kdePackages.okular', 'xreader',
            'cosmic-reader', 'gnome-calendar', 'gnome-contacts',
            'tradingview'],
  media:   ['vlc', 'mpv', 'parole', 'xfce.parole', 'showtime', 'celluloid',
            'cosmic-player', 'obs-studio', 'audacity', 'kdePackages.kdenlive',
            'davinci-resolve', 'handbrake', 'gpu-screen-recorder-gtk',
            'strawberry', 'kdePackages.elisa', 'gnome-music', 'decibels',
            'snapshot', 'pavucontrol', 'ffmpeg-full'],
  graphics:['gimp', 'gimp-with-plugins', 'inkscape', 'krita', 'darktable',
            'blender', 'freecad', 'ristretto', 'xfce.ristretto', 'loupe',
            'kdePackages.gwenview', 'xviewer', 'pix', 'simple-scan',
            'rawtherapee'],
  games:   ['steam', 'lutris', 'prismlauncher', 'protonup-qt', 'steam-run',
            'goverlay', 'mangohud', 'moonlight-qt', 'supertuxkart',
            'superTuxKart', 'zeroad', 'retroarch'],
  comms:   ['discord', 'signal-desktop', 'element-desktop', 'telegram-desktop',
            'dropbox', 'nextcloud-client', 'syncthing', 'warpinator',
            'localsend'],
  accessories: ['flameshot', 'kdePackages.spectacle', 'xfce4-screenshooter',
                'xfce.xfce4-screenshooter', 'gnome-screenshot',
                'cosmic-screenshot', 'copyq', 'gnome-calculator',
                'kdePackages.kcalc', 'galculator', 'file-roller', 'xarchiver',
                'kdePackages.ark', 'xfburn', 'xfce.xfburn', 'gnome-text-editor',
                'cosmic-edit', 'mousepad', 'xfce.mousepad', 'bulky', 'catfish',
                'xfce.catfish', 'xfce4-appfinder', 'xfce.xfce4-appfinder',
                'gigolo', 'xfce.gigolo', 'orage', 'xfce.orage', 'plank',
                'gnome-clocks', 'gnome-weather', 'gnome-maps',
                'gnome-font-viewer', 'gnome-disk-utility', 'gnome-characters',
                'gucharmap', 'orca', 'onboard'],
  files:   ['nautilus', 'kdePackages.dolphin', 'thunar', 'xfce.thunar', 'nemo',
            'cosmic-files', 'pcmanfm', 'yazi', 'ranger', 'nnn', 'mc',
            'doublecmd'],
  terminal:['alacritty', 'kitty', 'wezterm', 'ghostty', 'foot', 'rio',
            'kdePackages.konsole', 'gnome-console', 'gnome-terminal',
            'cosmic-term', 'xfce4-terminal', 'xfce.xfce4-terminal', 'tilix',
            'terminator'],
  system:  ['htop', 'btop', 'gnome-system-monitor',
            'kdePackages.plasma-systemmonitor', 'xfce4-taskmanager',
            'xfce.xfce4-taskmanager', 'gparted', 'keepassxc', 'seahorse',
            'kdePackages.kwalletmanager', 'baobab', 'timeshift', 'fastfetch',
            'inxi', 'lm_sensors', 'lshw', 'pciutils', 'blueman',
            'kdePackages.kinfocenter', 'gnome-logs', 'solaar', 'piper',
            'remmina', 'gnome-connections', 'virt-viewer', 'virtualbox',
            'kdePackages.discover'],
  // vscode is Microsoft's build and unfree; vscodium is the same editor built
  // from the same source without their telemetry and branding. Both are here
  // because people ask for them by different names, and the unfree one says so
  // on its row and again in the status bar.
  dev:     ['git', 'neovim', 'helix', 'kdePackages.kate', 'vscode', 'vscodium', 'gh',
            'direnv', 'tmux', 'gcc', 'clang', 'rustc', 'cargo', 'claude-code',
            // ollama, not ollama-cuda or ollama-rocm: which accelerator a
            // machine has is exactly the kind of thing this list stays out of,
            // and the plain build runs on all of them.
            'opencode', 'lmstudio', 'ollama', 'bash-language-server'],
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
      setStatus(say(
        `Could not add ${attr}: environment.systemPackages holds an ` +
        `expression this tool cannot edit. Add it by hand.`,
        `${attr} を追加できませんでした。environment.systemPackages が、` +
        `この道具では編集できない式になっています。手で追加してください。`), 'bad');
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
let renderRun = Promise.resolve();
// True while what is on hand is older than what is on the form.
let renderStale = false;

const ALL = 'all three';

/* The name the archive and its directory get, kept in step with bundle_name()
   in server.py — the client shows it before the download and the server is
   what decides it, so the two have to agree or the command printed here names
   a file that did not arrive. */
function bundleName() {
  const clean = ($('#s-host').value || '').trim()
    .replace(/[^A-Za-z0-9._-]/g, '').replace(/^[.-]+|[.-]+$/g, '');
  return clean || 'nixos';
}

/* What the `all three` tab shows. Every line is a comment, so the pane
   highlights it like the files either side of it and Check syntax has nothing
   to trip over. What it does not hold is said outright: the fourth file in
   that directory is the machine's own and nixgen never touches it. */
function bundleSummary() {
  const n = bundleName();
  return `# Download all three — one file holding the three nixgen wrote.
#
#   ${n}.tar.gz
#   \`-- ${n}/
#       |-- configuration.nix   the half you write by hand
#       |-- flake.nix           the way in to the whole system
#       \`-- generated.nix       what you built here
#
# Unpack it where you want the three to end up:
#
#   tar -xzf ${n}.tar.gz
#
# tar and gzip are on a NixOS install already; unzip is not, which is why
# this is not a .zip.
#
# hardware-configuration.nix is not in here. It was written when you
# installed and describes this machine's disks — keep the one you have.
#
# Check syntax on this tab parses all three.
`;
}

function currentText() {
  if (state.file === ALL) return bundleSummary();
  return state.file === 'generated.nix'
    ? generatedText
    : (state.starter[state.file] || '');
}

function pushRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { renderTimer = null; renderRun = doRender(); }, 120);
}

/* Rendering is debounced and happens on the server, so for a moment after a
   keystroke `generatedText` is the file as it was before it. Anything that
   hands that text over — the two downloads, Copy, Check syntax — has to wait
   for the render the keystroke asked for, or it hands over the previous
   version of the file and says nothing. Typing a host name and pressing
   Download all three straight away was enough to get an archive that did not
   match the screen. */
async function settled() {
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
    renderRun = doRender();
  }
  // doRender reports its own failure; this only has to not throw out of a
  // click handler on the way past. False means the file on hand is not the
  // form's, and the caller stops rather than handing over the old one.
  try { await renderRun; } catch { /* already said */ }
  return !renderStale;
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
  /* If this fails, what is on screen and in `generatedText` is the file as it
     was before the last change, and every button that hands the file over
     would hand over that one. Say so instead: a stale file that downloads
     cleanly is worse than a download that did not happen. */
  let res;
  try {
    res = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries, channel: state.channel }),
    }).then(r => r.json());
    if (typeof res.text !== 'string') throw new Error(res.error || 'no file came back');
  } catch (err) {
    renderStale = true;
    setStatus(say(
      `The file could not be rendered (${err.message}). What is shown is the ` +
      `last one that worked, and nothing will be handed over until this ` +
      `succeeds — reload the page.`,
      `ファイルを生成できませんでした(${err.message})。表示しているのは` +
      `最後に成功したものです。成功するまで何も渡しません。` +
      `ページを再読み込みしてください。`), 'bad');
    return;
  }
  renderStale = false;
  generatedText = res.text;
  if (state.file === 'generated.nix') paintCode(res.text);
  const notes = [];
  const todo = (res.text.match(/CHANGE_ME/g) || []).length;
  if (todo) {
    notes.push(say(
      `${todo} name${todo > 1 ? 's' : ''} still to fill in — look for CHANGE_ME.`,
      `未入力の名前が${todo}件あります。CHANGE_ME を探してください。`));
  }
  /* Nothing should be able to put two cards on one attribute: import replaces
     what it lands on, and adding an option you already have flashes that card
     instead. If one gets through anyway the file will not build, and the reason
     is not visible in the file — `already defined` names a line, not a card. So
     it is said here, regenerated on every render so it cannot be wiped. Paths
     with a slot still to fill are left out; they are all CHANGE_ME until the
     name is typed, and the line above is already about them. */
  const seenPath = new Map();
  for (const e of state.selected.values()) {
    const path = resolvePath(e);
    if (path.includes('CHANGE_ME')) continue;
    seenPath.set(path, (seenPath.get(path) || 0) + 1);
  }
  const twice = [...seenPath].filter(([, n]) => n > 1).map(([path]) => path);
  if (twice.length) {
    notes.push(say(
      `Set twice: ${twice.join(', ')}. NixOS refuses a file that defines one ` +
      `attribute twice, so remove one of the cards.`,
      `二重に設定されています: ${twice.join('、')}。NixOS は同じ属性を2回定義した` +
      `ファイルを受け付けません。どちらかのカードを削除してください。`));
  }
  const clashes = [...state.starterDefines].filter(
    p => new RegExp('^  ' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' =', 'm').test(res.text));
  if (clashes.length) {
    notes.push(say(
      `Also set in the starter configuration.nix: ${clashes.join(', ')}. ` +
      `Shown in red. Delete it from one of the two files — if both use ` +
      `lib.mkDefault, NixOS cannot choose and the rebuild fails.`,
      `スターターの configuration.nix にも同じ設定があります: ${clashes.join('、')}。` +
      `赤で表示しています。どちらかのファイルから消してください。両方が ` +
      `lib.mkDefault だと NixOS はどちらを採るか決められず、rebuild が失敗します。`));
  }
  const unfree = [...state.unfree].filter(a => res.text.includes('pkgs.' + a));
  if (unfree.length) {
    notes.push(say(
      `${unfree.join(', ')} ${unfree.length > 1 ? 'are' : 'is'} unfree. ` +
      `Set nixpkgs.config.allowUnfree = true; in your configuration.nix.`,
      `${unfree.join('、')} は unfree です。configuration.nix に ` +
      `nixpkgs.config.allowUnfree = true; を設定してください。`));
  }
  /* The NVIDIA driver is unfree, and the reminder above cannot see it: that
     one watches environment.systemPackages, and this arrives through a
     module. It belongs here rather than in a one-off message from the preset,
     because a note that is regenerated on every render is one that cannot be
     wiped by the next one — which is exactly what happened when it was. */
  if (/^\s*hardware\.nvidia\./m.test(res.text)) {
    notes.push(say(
      `The NVIDIA driver is unfree. Set nixpkgs.config.allowUnfree = true; ` +
      `in your configuration.nix, or the build refuses it.`,
      `NVIDIA のドライバは unfree です。configuration.nix に ` +
      `nixpkgs.config.allowUnfree = true; を設定しないとビルドが拒否されます。`));
  }
  /* Steam runs from the package, but the module is what puts the 32-bit
     graphics drivers in place and can open the remote-play ports. Saying so
     beats leaving Steam out of the list, which only sent people looking. */
  if (alreadyListed('steam')) {
    notes.push(say(
      `steam is listed as a package. programs.steam.enable under Options is ` +
      `the fuller way — it sets up the 32-bit graphics drivers, and can open ` +
      `the remote-play ports.`,
      `steam をパッケージとして入れています。Options タブの ` +
      `programs.steam.enable のほうが本筋です。32bit のグラフィックドライバを` +
      `揃え、リモートプレイのポートも開けられます。`));
  }
  /* VirtualBox is the stronger version of the same case: the package on its
     own gives you a VirtualBox that cannot start a virtual machine, because
     the kernel modules and the group come from the module. Said here rather
     than from the row that added it, so it survives the next render. */
  if (alreadyListed('virtualbox')) {
    notes.push(say(
      'virtualbox is listed as a package, which on its own cannot start a ' +
      'virtual machine. virtualisation.virtualbox.host.enable under Options ' +
      'is what builds the kernel modules and puts you in the vboxusers group.',
      'virtualbox をパッケージとして入れていますが、それだけでは仮想マシンを' +
      '起動できません。カーネルモジュールと vboxusers グループを用意するのは、' +
      'Options タブの virtualisation.virtualbox.host.enable です。'));
  }
  if (notes.length) setStatus(notes.join('\n'), 'todo');
  else if ($('#status').classList.contains('todo')) setStatus('');
  // Every change to the module comes through here, so this is the one place
  // that catches a package added by clicking, removed from the card, or typed
  // into the box by hand.
  syncAddedRows();
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

/* What an existing configuration.nix can tell the Setup tab about the machine.

   Every path here has a field on that tab, and the starter file writes it. So
   the setting moves rather than being copied: leaving the card as well would
   put the same attribute in both files, which is what the red markers are for
   and not something to hand somebody on purpose. Nothing is lost — the value
   is in the field, and the import summary lists what went there.

   Only values that arrived as values are read. An expression carried over
   verbatim (`lib.mkIf …`) stays a card, because a form field cannot hold it. */
function fillSetupFrom(incoming) {
  const value = new Map();
  for (const x of incoming) {
    if (!x.entry.verbatim) value.set(resolvePath(x.entry), x.entry.value);
  }
  const used = [];
  const take = (path, fn) => {
    if (!value.has(path)) return;
    if (fn(value.get(path)) === false) return;   // not a shape the field holds
    used.push(path);
  };

  take('networking.hostName', v => {
    if (typeof v !== 'string' || !v.trim()) return false;
    $('#s-host').value = v.trim();
  });
  take('networking.networkmanager.enable', v => {
    if (typeof v !== 'boolean') return false;
    $('#s-networkmanager').checked = v;
  });
  /* Flakes arrive inside `nix.settings`, which is one attrs option holding a
     key per line of Nix source — `{"experimental-features": "[ \"flakes\" ]"}`
     — so the flag is read out of the source rather than from a list. The card
     only moves to Setup when experimental-features is all it holds: substituters
     and trusted-users belong to nobody's Setup tab, and taking them out of the
     module to get at one key beside them would lose them. */
  take('nix.settings', v => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const src = v['experimental-features'];
    if (typeof src !== 'string') return false;
    $('#s-flakes').checked = /\bflakes\b/.test(src);
    return Object.keys(v).length === 1 ? undefined : false;
  });
  take('system.stateVersion', v => {
    if (typeof v !== 'string' || !/^\d\d\.\d\d$/.test(v.trim())) return false;
    $('#s-state').value = v.trim();
    // It came from their own file, so a later channel switch must not rewrite
    // it — the same rule as typing one in.
    state.stateTouched = true;
  });
  /* `nixpkgs.hostPlatform` is `string or (attribute set)`, and the form holds a
     union as Nix source — so the value arrives as `"aarch64-linux"` with the
     quotes in it, the same way console.keyMap does. An attribute set is a
     cross-compilation setup and has no place in a dropdown of two. */
  take('nixpkgs.hostPlatform', v => {
    if (typeof v !== 'string') return false;
    const bare = (/^\s*"([^"]*)"\s*$/.exec(v) || [])[1] ?? v.trim();
    if (![...$('#s-system').options].some(o => o.value === bare)) return false;
    $('#s-system').value = bare;
  });

  // Whichever boot loader is switched on, with the lines the starter writes
  // alongside it.
  if (value.get('boot.loader.systemd-boot.enable') === true) {
    $('#s-bootloader').value = 'systemd-boot';
    used.push('boot.loader.systemd-boot.enable');
    if (value.get('boot.loader.efi.canTouchEfiVariables') === true) {
      used.push('boot.loader.efi.canTouchEfiVariables');
    }
  } else if (value.get('boot.loader.grub.enable') === true) {
    $('#s-bootloader').value = 'grub';
    used.push('boot.loader.grub.enable');
    const dev = value.get('boot.loader.grub.device');
    if (typeof dev === 'string' && dev.trim()) {
      $('#s-grub-device').value = dev.trim();
      used.push('boot.loader.grub.device');
    }
  }

  // The first normal user, and the groups it is in. A name that is not a plain
  // identifier is left alone: it would not survive the field, which has to
  // produce `users.users.<name>`.
  for (const [path, v] of value) {
    const m = /^users\.users\.([A-Za-z_][A-Za-z0-9_-]*)\.isNormalUser$/.exec(path);
    if (!m || v !== true) continue;
    $('#s-make-user').checked = true;
    $('#s-user').value = m[1];
    used.push(path);
    const groups = value.get(`users.users.${m[1]}.extraGroups`);
    if (Array.isArray(groups) && groups.length) {
      $('#s-groups').value = groups.join(' ');
      used.push(`users.users.${m[1]}.extraGroups`);
    }
    break;
  }
  return used;
}

/* Two buttons, one reader. Which file was picked decides where its contents
   land: a configuration.nix is the machine's own file, so it fills the Setup
   tab and the rest of it is carried into the configuration.nix that tab
   writes; a generated.nix is a module, so it becomes cards. Sending a module
   through the first route would bury settings in a file nixgen only half
   writes, and sending a configuration.nix through the second is what used to
   happen — it worked, but it put your file in the wrong one of the two. */
$('#btn-import').addEventListener('click', () => $('#file').click());
$('#btn-import-gen').addEventListener('click', () => $('#file-gen').click());
$('#file').addEventListener('change', ev => readInto(ev, 'configuration'));
$('#file-gen').addEventListener('change', ev => readInto(ev, 'module'));

async function readInto(ev, into) {
  const f = ev.target.files[0];
  if (!f) return;
  ev.target.value = '';
  const text = await f.text();
  setStatus(say('Reading ' + f.name + '…', f.name + ' を読んでいます…'));
  const r = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(r => r.json());

  if (r.error) {
    showNotice([{ cls: 'bad',
                  title: 'Could not read that file',
                  title_ja: 'そのファイルを読めませんでした',
                  body: r.error }]);
    setStatus(say('Import failed.', '読み込みに失敗しました。'), 'bad');
    return;
  }

  const incoming = r.matched.map(m => ({
    path: m.path,
    entry: {
      path: m.path,
      type: m.type,
      type_str: m.type_str,
      description: m.description,
      default_txt: m.default_txt,
      example_txt: m.example_txt,
      slots: m.slots || [],
      value: m.value,
    },
  }));
  const verbatim = [
    ...(r.structure || []).map(x => ({ ...x, from: x.path, kind: 'structure' })),
    ...r.expression.map(x => ({ ...x, path: x.option, from: x.path, kind: 'expression' })),
    ...r.unknown.map(x => ({ ...x, from: x.path, kind: 'unknown' })),
  ];
  for (const v of verbatim) {
    incoming.push({
      path: v.from,
      entry: {
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
      },
    });
  }

  /* A file can land on a form that already has settings in it, and reading the
     same file twice is the ordinary way to get there. Two cards that render the
     same attribute produce a file NixOS refuses outright — `error: attribute
     'services.openssh.enable' already defined` — so what the file says replaces
     what was there rather than joining it. Compared by the path each card
     renders to, not by its key: import files a repeat under a suffixed key, so
     the keys can differ while the attribute is the same. */
  /* A module goes into the module, and nothing else happens: its settings are
     the ones nixgen manages, and the Setup tab has no business being rewritten
     by them. */
  if (into === 'module') return intoModule(f, r, incoming, []);

  /* A configuration.nix is the machine's own file. The fields on the Setup tab
     take what they hold, and everything else is carried into the
     configuration.nix that tab writes — the module is left alone. `imports` is
     the exception: the starter writes its own, so the paths are merged into
     that list rather than carried as a line that would define it twice. */
  const toSetup = fillSetupFrom(incoming);
  const moved = new Set(toSetup);
  const rest = incoming.filter(x => !moved.has(resolvePath(x.entry)));

  const ownImports = ['./hardware-configuration.nix', './generated.nix'];
  const extraImports = [];
  const carried = [];
  for (const x of rest) {
    if (resolvePath(x.entry) === 'imports') {
      splitNixList(String(x.entry.value).replace(/^[^[]*\[/, '').replace(/\][^\]]*$/, ''))
        .filter(p => p && !ownImports.includes(p))
        .forEach(p => extraImports.push(p));
      continue;
    }
    carried.push({
      path: resolvePath(x.entry),
      segments: x.entry.segments || segmentsFor(x.entry),
      type: x.entry.type,
      value: x.entry.value,
      note: x.entry.note,
    });
  }
  state.carried = carried;
  state.carriedImports = extraImports;
  state.lastTouched = null;
  if (toSetup.length) syncSetupVisibility();
  await loadStarter();
  showFile('configuration.nix');

  const notes = [];
  notes.push({ cls: 'ok',
    title: `Read ${r.matched.length} settings from ${f.name}`,
    title_ja: `${f.name} から${r.matched.length}件の設定を読み込みました`,
    body: 'They are in configuration.nix on the right, not in the module: ' +
          'this is your machine\'s own file, and that is the one the Setup tab ' +
          'writes. The module is for what you add under Options and Packages.',
    body_ja: 'いずれも右の configuration.nix に入っています。module ではありません。' +
             'これはこのマシン自身のファイルで、それを書くのは Setup タブだから' +
             'です。module は Options と Packages で足すもののための場所です。' });
  if (toSetup.length) {
    notes.push({ cls: 'ok',
      title: `${toSetup.length} became fields on the Setup tab`,
      title_ja: `${toSetup.length}件が Setup タブの入力欄になりました`,
      list: toSetup,
      body: 'The host name, the user, the boot loader and the rest are written ' +
            'from those fields, so change them there.',
      body_ja: 'ホスト名・ユーザー・ブートローダーなどは、その入力欄から' +
               '書き出されます。変更はそちらで行ってください。' });
  }
  if (carried.length) {
    notes.push({ cls: 'ok',
      title: `${carried.length} carried into configuration.nix as they were`,
      title_ja: `${carried.length}件を configuration.nix にそのまま写しました`,
      list: carried.map(c => c.path),
      body: 'nixgen has no field for these, so they are copied through ' +
            'unchanged, under a comment saying where they came from.',
      body_ja: 'これらには nixgen に対応する入力欄が無いので、どこから来たかを' +
               '書いたコメントの下に、そのまま写してあります。' });
  }
  if (extraImports.length) {
    notes.push({ cls: 'ok',
      title: `${extraImports.length} import(s) merged into the imports list`,
      title_ja: `imports の行を${extraImports.length}件、取り込みました`,
      list: extraImports,
      body: 'Keep this configuration.nix in the same directory as the file you ' +
            'read in, so those relative paths still resolve.',
      body_ja: '相対パスが解決できるよう、この configuration.nix は読み込んだ' +
               'ファイルと同じディレクトリに置いてください。' });
  }
  (r.notes || []).forEach(n => notes.push({ cls: 'warn',
    title: 'Adjusted while reading', title_ja: '読み込みの際に調整した点',
    body: n }));
  if (r.unknown.length) {
    notes.push({ cls: 'warn',
      title: `${r.unknown.length} of them are not options in this release`,
      title_ja: `そのうち${r.unknown.length}件は、このリリースに無い項目です`,
      list: r.unknown.map(x => `${x.path} — ${x.why}`),
      body: 'Carried through so nothing is lost — check each one, since ' +
            'nixos-rebuild will reject an option that no longer exists.',
      body_ja: '何も失わないよう写してありますが、1件ずつ確認してください。' +
               '無くなった項目は nixos-rebuild が拒否します。' });
  }
  showNotice(notes);
  setStatus(say(
    `${f.name}: ${r.matched.length} settings read into configuration.nix.`,
    `${f.name}: ${r.matched.length}件の設定を configuration.nix に読み込みました。`),
    'ok');
  return;
}

/* The module route: what it used to do for every file, and still the right
   thing for one nixgen wrote. */
async function intoModule(f, r, incoming, toSetup) {
  const kept = incoming;
  const moved = new Set(toSetup);

  const arriving = new Set(kept.map(x => resolvePath(x.entry)));
  const replaced = [];
  for (const [key, entry] of [...state.selected]) {
    const path = resolvePath(entry);
    if (!arriving.has(path) && !moved.has(path)) continue;
    state.selected.delete(key);
    if (arriving.has(path)) replaced.push(path);
  }
  for (const x of kept) state.selected.set(freeKey(x.path), x.entry);
  state.lastTouched = null;
  if (toSetup.length) {
    syncSetupVisibility();
    await loadStarter();
  }

  const notes = [];
  notes.push({ cls: 'ok',
    title: `Imported ${r.matched.length} settings from ${f.name}`,
    title_ja: `${f.name} から${r.matched.length}件の設定を読み込みました`,
    body: r.used_nix
      ? 'Parsed with nix-instantiate. Your file was not modified.'
      : 'Read directly — nix-instantiate was not on PATH.',
    body_ja: r.used_nix
      ? 'nix-instantiate で解析しました。読んだファイルは書き換えていません。'
      : 'nix-instantiate が PATH に無かったため、自前の読み取りを使いました。' });
  (r.notes || []).forEach(n => notes.push({ cls: 'warn',
    title: 'Adjusted while reading', title_ja: '読み込みの際に調整した点',
    body: n }));
  if (toSetup.length) {
    notes.push({ cls: 'ok',
      title: `${toSetup.length} went to the Setup tab`,
      title_ja: `${toSetup.length}件が Setup タブに入りました`,
      list: toSetup,
      body: 'These describe the machine, and the Setup tab is what writes ' +
            'them — into configuration.nix rather than into the module. They ' +
            'are fields there now, so change them there. Nothing was lost: ' +
            'they are out of the module because they would otherwise be in ' +
            'both files at once.',
      body_ja: 'いずれもマシンそのものを表す項目で、これらを書くのは Setup ' +
               'タブです。module ではなく configuration.nix に入ります。' +
               'いまは入力欄になっているので、変更はそちらで行ってください。' +
               '失われたものはありません。module から外したのは、そのままだと' +
               '2つのファイルに同じ設定が入るからです。' });
  }
  if (replaced.length) {
    notes.push({ cls: 'warn',
      title: `${replaced.length} setting(s) already in the form were replaced`,
      title_ja: `フォームにあった${replaced.length}件を置き換えました`,
      list: replaced,
      body: 'The file you just read is what they say now. Two cards for one ' +
            'attribute cannot both be written — NixOS refuses a file that ' +
            'defines the same one twice.',
      body_ja: 'いま読み込んだファイルの内容になっています。1つの属性に' +
               '2枚のカードがあると両方は書けません。NixOS は同じ属性を' +
               '2回定義したファイルを受け付けないからです。' });
  }
  if (r.structure && r.structure.length) {
    notes.push({ cls: 'ok',
      title: `${r.structure.length} module-structure line(s) carried over`,
      title_ja: `モジュール構造の行を${r.structure.length}件そのまま写しました`,
      list: r.structure.map(x => `${x.path} = ${x.preview}`),
      body: 'imports and friends are copied through unchanged. Keep this file in the same directory as the one you imported, so its relative paths still resolve.',
      body_ja: 'imports のような行は、そのまま写します。相対パスが解決できるよう、' +
               'このファイルは読み込んだファイルと同じディレクトリに置いてください。' });
  }
  if (r.expression.length) {
    notes.push({ cls: 'warn',
      title: `${r.expression.length} kept as written: the value is an expression`,
      title_ja: `値が式のため、${r.expression.length}件を書かれたとおりに写しました`,
      list: r.expression.map(x => `${x.option} = ${x.preview}`),
      body: 'lib.mkIf, let bindings and the like cannot go in a form, so they are copied into the output unchanged and highlighted. If one refers to a let binding from your original file, define it there too or Check syntax will flag it.',
      body_ja: 'lib.mkIf や let 束縛はフォームに載せられないので、そのまま出力に' +
               '写して色を付けています。元のファイルの let 束縛を参照している場合は、' +
               'そちらにも定義を残してください。無いと Check syntax で指摘されます。' });
  }
  if (r.unknown.length) {
    notes.push({ cls: 'warn',
      title: `${r.unknown.length} kept as written: not an option in this release`,
      title_ja: `このリリースに無い項目を${r.unknown.length}件、そのまま写しました`,
      list: r.unknown.map(x => `${x.path} — ${x.why}`),
      body: 'Copied into the output unchanged so nothing is lost. Highlighted in the file — check each one, since nixos-rebuild will reject an option that no longer exists.',
      body_ja: '何も失わないよう、そのまま出力に写して色を付けています。' +
               '無くなった項目は nixos-rebuild が拒否するので、1件ずつ確認して' +
               'ください。' });
  }
  showNotice(notes);
  rerender();
  runSearch();
  setStatus(say(`Imported ${r.matched.length} settings.`,
                `${r.matched.length}件の設定を読み込みました。`), 'ok');
}

function showNotice(items) {
  const box = $('#notice');
  box.innerHTML = '';
  if (!items.length) return;
  items.forEach(it => {
    const n = el('div', 'notice ' + it.cls);
    n.appendChild(el('div', 'nt', it.title));
    if (it.title_ja) n.appendChild(el('div', 'nt ja', it.title_ja));
    if (it.body) n.appendChild(el('div', 'nb', it.body));
    if (it.body_ja) n.appendChild(el('div', 'nb ja', it.body_ja));
    if (it.list) {
      const ul = el('ul', 'nl');
      it.list.slice(0, 40).forEach(t => ul.appendChild(keep(el('li', null, t))));
      if (it.list.length > 40) {
        ul.appendChild(el('li', null,
          `…and ${it.list.length - 40} more — ほか${it.list.length - 40}件`));
      }
      n.appendChild(ul);
    }
    box.appendChild(n);
  });
  const x = el('button', 'mini', 'dismiss — 閉じる');
  x.addEventListener('click', () => { box.innerHTML = ''; });
  box.appendChild(x);
}

/* --------------------------------------------------------------- actions */

$('#btn-copy').addEventListener('click', async () => {
  if (!await settled()) return;
  try {
    await navigator.clipboard.writeText(currentText());
    setStatus(say('Copied to clipboard.', 'クリップボードにコピーしました。'), 'ok');
  } catch {
    setStatus(say('Clipboard blocked by the browser. Use Download instead.',
                  'ブラウザにクリップボードを止められました。Download を使ってください。'),
              'bad');
  }
});

function saveBlob(blob, name) {
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* The three files are already here; the server builds the archive because
   Python has tarfile and the browser has nothing that writes a tar. */
async function downloadBundle() {
  if (!await settled()) return;
  const n = bundleName();
  /* The starter files come from the server when the Setup tab is filled in. If
     that never happened — the first request failed, the page was opened while
     the index was still building — the archive would be two empty files and a
     module, which looks like a download that worked. */
  if (!state.starter['configuration.nix'] || !state.starter['flake.nix']) {
    return setStatus(say(
      'The starter files are not ready yet — open Setup, check the fields, ' +
      'and try again. Nothing was downloaded.',
      'スターターファイルがまだ用意できていません。Setup タブを開いて入力欄を' +
      '確かめてから、もう一度試してください。何もダウンロードしていません。'), 'bad');
  }
  setStatus(say('Packing…', 'まとめています…'));
  const res = await fetch('/api/bundle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: $('#s-host').value,
      files: {
        'configuration.nix': state.starter['configuration.nix'] || '',
        'flake.nix': state.starter['flake.nix'] || '',
        'generated.nix': generatedText,
      },
    }),
  });
  if (!res.ok) return setStatus(say('Could not build the archive.',
                                    '書庫を作れませんでした。'), 'bad');
  saveBlob(await res.blob(), n + '.tar.gz');
  setStatus(say(
    `${n}.tar.gz — three files under ${n}/. Unpack it with ` +
    `tar -xzf ${n}.tar.gz. hardware-configuration.nix is not in it: keep the ` +
    `one this machine already has.`,
    `${n}.tar.gz — ${n}/ の下に3つのファイルが入っています。` +
    `tar -xzf ${n}.tar.gz で展開してください。hardware-configuration.nix は` +
    `含まれていません。このマシンにあるものをそのまま使ってください。`), 'ok');
}

$('#btn-dl').addEventListener('click', async () => {
  if (!await settled()) return;
  if (state.file === ALL) return downloadBundle();
  saveBlob(new Blob([currentText()], { type: 'text/plain' }), state.file);
});

$('#btn-dl-all').addEventListener('click', downloadBundle);

/* ------------------------------------------------------- system update */

/* A yes/no box, both languages, resolving to true or false. `<dialog>` rather
   than window.confirm: confirm() is one line of plain text, and what is about
   to happen here needs a list and a command in a box. */
function ask(build, yesLabel) {
  const dlg = $('#dlg');
  const body = dlg.querySelector('.dlg-body');
  body.innerHTML = '';
  build(body);
  $('#dlg-yes').textContent = yesLabel;
  dlg.showModal();
  return new Promise(resolve => {
    const done = ok => {
      $('#dlg-yes').removeEventListener('click', yes);
      $('#dlg-no').removeEventListener('click', no);
      dlg.removeEventListener('cancel', no);
      dlg.close();
      resolve(ok);
    };
    const yes = () => done(true);
    const no = () => done(false);
    $('#dlg-yes').addEventListener('click', yes);
    $('#dlg-no').addEventListener('click', no);
    dlg.addEventListener('cancel', no);
  });
}

const line = (parent, cls, text) => parent.appendChild(el('p', cls, text));

/* The command the second dialog hands over.

   One `bash -c` rather than a block of shell: it has to survive being pasted
   into fish, which has no heredocs and different `read` flags, and into zsh —
   all three were tried. Nothing inside is single-quoted, because the whole
   thing is.

   The download folder is looked for rather than assumed: `xdg-user-dir` knows
   the localised name, and when it is not installed it answers with $HOME, so
   the loop tests for the archive itself rather than for the directory —
   ~/Downloads and ~/ダウンロード are both tried, and the home directory last.

   The old files are kept: `cp --backup=numbered` leaves configuration.nix.~1~
   beside the new one, so a bad rebuild can be walked back. Only the three
   nixgen wrote are touched; hardware-configuration.nix is never in the
   archive and never named here. */
function updateCommand() {
  const n = bundleName();
  const rebuild = $('#s-flakes').checked
    ? `sudo nixos-rebuild switch --flake /etc/nixos#${n}`
    : 'sudo nixos-rebuild switch';
  return 'bash -c ' + "'" + [
    'set -e',
    `h=${n}`,
    'for d in "$(xdg-user-dir DOWNLOAD 2>/dev/null)" "$HOME/Downloads" ' +
      '"$HOME/ダウンロード" "$HOME"; do ' +
      '[ -f "$d/$h.tar.gz" ] && a="$d/$h.tar.gz" && break; done',
    '[ -n "$a" ] || { echo "$h.tar.gz not found in your download folder"; exit 1; }',
    't=$(mktemp -d)',
    'tar -xzf "$a" -C "$t"',
    'echo',
    'echo "These three will overwrite the ones in /etc/nixos ' +
      '(the old ones are kept as .~1~):"',
    'ls -1 "$t/$h"',
    'read -r -p "Copy them in? [y/N] " r',
    '[ "$r" = y ] || exit 1',
    'sudo cp --backup=numbered -v "$t/$h"/configuration.nix ' +
      '"$t/$h"/flake.nix "$t/$h"/generated.nix /etc/nixos/',
    'read -r -p "Rebuild the system now? [y/N] " r',
    '[ "$r" = y ] || exit 1',
    rebuild,
  ].join('; ') + "'";
}

/* Three confirmations, as asked for: one here before the download, and two
   inside the command — before it overwrites /etc/nixos, and before it
   rebuilds. The privileged half is a command you run rather than something
   this server does: nixgen has no authentication, and an endpoint that could
   overwrite /etc/nixos and rebuild would be reachable from any page open in
   the same browser. */
async function systemUpdate() {
  const n = bundleName();
  const ok = await ask(body => {
    body.appendChild(el('h3', null, 'Update this machine from what is on screen?'));
    body.appendChild(el('h3', 'ja', 'いま画面にある内容で、このマシンを更新しますか。'));
    line(body, null, 'Three steps follow, each one asked about before it happens:');
    const ol = el('ol');
    [`${n}.tar.gz is downloaded and unpacked`,
     'its three files overwrite the ones in /etc/nixos, keeping the old ones',
     'the system is rebuilt and switched to',
    ].forEach(t => ol.appendChild(el('li', null, t)));
    body.appendChild(ol);
    line(body, 'ja', '手順は3つで、それぞれの前に確認します。' +
                     `${n}.tar.gz をダウンロードして展開、その3ファイルで ` +
                     '/etc/nixos を上書き(元のファイルは残します)、最後に' +
                     'システムを再構築して切り替えます。');
    line(body, null, 'Finish setting everything up first, and press Check syntax: ' +
                     'this replaces the configuration your machine boots from.');
    line(body, 'ja', '設定をひととおり終えて Check syntax を通してから実行して' +
                     'ください。このマシンが起動に使う設定を置き換えます。');
  }, 'Download — ダウンロード');
  if (!ok) return;

  await downloadBundle();
  if (renderStale) return;

  const cmd = updateCommand();
  const copied = await ask(body => {
    body.appendChild(el('h3', null, 'Now run this in a terminal'));
    body.appendChild(el('h3', 'ja', '続きはターミナルで、このコマンドを実行してください'));
    line(body, null, 'It finds the archive in your download folder whatever that ' +
                     'folder is called, unpacks it, and asks twice: once before ' +
                     'copying into /etc/nixos, once before the rebuild.');
    line(body, 'ja', 'ダウンロード先のフォルダ名が Downloads でも ダウンロード でも' +
                     '見つけます。展開したあと、/etc/nixos へコピーする前と、' +
                     '再構築の前に、それぞれ確認を求めます。');
    body.appendChild(keep(el('pre', 'cmd', cmd)));
    line(body, null, 'sudo will ask for your password. The files it replaces are ' +
                     'kept beside the new ones as configuration.nix.~1~ and so on, ' +
                     'and hardware-configuration.nix is not touched.');
    line(body, 'ja', 'sudo がパスワードを尋ねます。置き換えられたファイルは ' +
                     'configuration.nix.~1~ のような名前で隣に残り、' +
                     'hardware-configuration.nix には触れません。');
  }, 'Copy the command — コマンドをコピー');
  if (!copied) return;

  try {
    await navigator.clipboard.writeText(cmd);
    setStatus(say(
      'The command is on the clipboard. Paste it into a terminal — it asks ' +
      'before it overwrites /etc/nixos and again before the rebuild.',
      'コマンドをクリップボードにコピーしました。ターミナルに貼り付けて' +
      'ください。/etc/nixos を上書きする前と、再構築の前に、それぞれ確認を' +
      '求めます。'), 'ok');
  } catch {
    setStatus(say(
      'Clipboard blocked by the browser — the command is in the box that was ' +
      'just open; press System update again to see it.',
      'ブラウザにクリップボードを止められました。コマンドはいま開いていた枠に' +
      '出ています。System update をもう一度押すと再表示できます。'), 'bad');
  }
}

$('#btn-update').addEventListener('click', systemUpdate);

/* The verdict in both languages. A failure carries the parser's own words
   after it — those are Nix's, in Nix's English, and translating them would
   mean somebody searching for the error text could not find it. */
function sayCheck(r) {
  if (r.ok === true) return say('Parses cleanly.', '構文に問題ありません。');
  if (r.ok === null) {
    return say('nix-instantiate not found on PATH — syntax check skipped.',
               'nix-instantiate が PATH にありません。構文チェックは行いません。');
  }
  return say('Nix could not parse this file:',
             'Nix がこのファイルを解析できませんでした:') + '\n' + r.message;
}

const checkText = text => fetch('/api/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text }),
}).then(r => r.json());

$('#btn-check').addEventListener('click', async () => {
  if (!await settled()) return;
  setStatus(say('Checking…', '確認しています…'));
  if (state.file !== ALL) {
    const r = await checkText(currentText());
    return setStatus(sayCheck(r), r.ok === true ? 'ok' : r.ok === false ? 'bad' : '');
  }
  /* On the archive tab there is no one file to check, so it checks the three
     that are about to be downloaded and names which of them failed — a report
     that says only "parses cleanly" would not say what did. */
  const names = ['generated.nix', 'configuration.nix', 'flake.nix'];
  const texts = [generatedText, state.starter['configuration.nix'] || '',
                 state.starter['flake.nix'] || ''];
  const rs = await Promise.all(texts.map(checkText));
  if (rs.some(r => r.ok === null)) return setStatus(sayCheck(rs[0]), '');
  const bad = names.filter((_, i) => rs[i].ok === false);
  if (!bad.length) return setStatus(say('All three parse cleanly.',
                                        '3つとも構文に問題ありません。'), 'ok');
  setStatus(say('Nix could not parse:', 'Nix が解析できませんでした:') + '\n' +
            bad.map(n => `${n}: ${rs[names.indexOf(n)].message}`).join('\n'),
            'bad');
});

/* One message, both languages. The status bar wraps on whitespace and these
   are sentences rather than labels, so the Japanese goes on its own line
   instead of after a dash the way the dropdown options carry it. */
const say = (en, ja) => `${en}\n${ja}`;

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
