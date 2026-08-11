/* nixgen — client. Vanilla JS, no build step. */

/* Shown in the header. Bump it whenever this file changes, so "the fix did not
   work" can be told apart from "the old file is still being served". */
const BUILD = '2026-08-12m';

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
/* The dynamic Setup notes carry both languages the way the status bar does:
   the Japanese is one appended line (white-space: pre-line renders the \n),
   composed as a whole sentence rather than mirrored fragment by fragment. */
function jaLine(node, text) { node.append('\n' + text); }

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
  jaLine(note, `${many ? list.length + '個の' : ''}索引が残っています(計${mb} MB)。` +
               `もうここから選ぶことはできず、必要になれば再構築で戻せます。`);
  btn.hidden = false;
  btn.textContent = `Remove ${many ? 'them' : 'it'} (${mb} MB) — 削除する`;
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
    jaLine(note, daily
      ? 'flake.lock は初回ビルドを固定しますが、unstable は明日には別のツリーです。左のオプションとビルド結果は数日でずれます。両者を一致させるのはコミット指定のほうです。'
      : 'flake.lock は初回ビルドを固定するので再現できます。ただしブランチは進むため、ここで選んだ設定が後のビルドに無いことがあります。');
    return;
  }
  if (state.starter.revision) {
    note.className = 'note';
    note.append('What you were offered and what you build are the same tree. ' +
                'This is the safer of the two.');
    jaLine(note, '提示されたオプションとビルドされるものが同じツリーになります。2つのうち安全なのはこちらです。');
    return;
  }
  note.className = 'warn';
  note.append('No commit was available, so flake.nix names the branch instead. ' +
              'Building the index for this release records one.');
  jaLine(note, 'コミットが取得できなかったため、flake.nix はブランチを指します。このリリースの索引を作るとコミットが記録されます。');
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
    jaLine(note, `左のオプション一覧はこのチャンネルから作られています。` +
      (state.ageDays == null ? '' :
        `一覧の公開は${state.ageDays === 0 ? '今日' : state.ageDays === 1 ? '昨日' : state.ageDays + '日前'}です。`) +
      (state.stale ? (want === state.unstable
        ? 'その後 unstable は動いています。作り直してから信用してください。'
        : '作り直す価値があります。') : ''));
    btn.hidden = !state.stale;
    btn.textContent = `Rebuild the ${want} index — 索引を作り直す`;
    return;
  }
  note.className = 'note';
  const ready = state.built.includes(want);
  note.append(pinPhrase(want, true));
  note.append(', but the options on the left are still from ');
  note.append(ident(state.indexed));
  note.append('.');
  jaLine(note, `左のオプション一覧はまだ ${state.indexed} のものです。`);
  btn.hidden = false;
  btn.textContent = ready
    ? `Switch the options to ${want} — 一覧を切り替える`
    : `Build the ${want} index (a few minutes) — 索引を作る(数分)`;
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
    `Letters, digits, - and _ only, starting with a letter. Using "${fallback}" for now.\n` +
    `使えるのは英字・数字・-・_ で、先頭は英字です。いまは "${fallback}" を使っています。`;
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
  if (!ok) warn.textContent = 'Two digits, a dot, two digits — 26.05. Falling back for now.\n' +
    '数字2桁・ドット・数字2桁の形式です(例: 26.05)。いまは既定値を使っています。';
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
  // Both act on the file being shown, so both stand down on `all three`,
  // where there is no single file to copy or take.
  $('#btn-copy').hidden = name === ALL;
  $('#btn-dl-one').hidden = name === ALL;
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
/* Sway is the one compositor that furnishes itself, and that includes a bar:
   `/etc/sway/config` ends with a `bar { position top … }` block running swaybar
   with a clock in it. With noctalia on top of that the screen has two, which is
   what a real machine reported. There is no option for it — the sway module
   offers no `extraConfig`, and `mode invisible` (sway-bar(5)) would have to go
   inside that same block — so the config file itself is replaced with the
   package's own minus the bar.

   **`config.programs.sway.package`, never `pkgs.sway`.** They are different
   builds of the same version: the module's has `isNixOS = true`, whose config
   ends with `include /etc/sway/config.d/*` — the line that loads the systemd
   integration, which is what starts noctalia — and draws its wallpaper from
   /run/current-system. Plain `pkgs.sway` is patched the other way: the include
   removed, the wallpaper commented out. Deriving from that one shipped a
   config with no include and no background, and a real machine came up black
   with no shell — the report that produced this comment. The sed only removes
   the bar block, so the include line at the end survives.

   NixOS sets `environment.etc."sway/config"` with `mkOptionDefault`, so this
   overrides it rather than colliding with it. */
const ETC_PATH = 'environment.etc';

const SWAY_CONFIG_NO_BAR =
  `# The module's own sway config (isNixOS build: wallpaper + the config.d
    # include that starts the session services) minus its swaybar block, so
    # the only bar on screen is the one noctalia draws.
    pkgs.runCommand "sway-config-no-bar" { } ''
      sed '/^bar {/,/^}/d' \${config.programs.sway.package}/etc/sway/config > $out
    ''`;

const DESKTOPS = {
  gnome: { label: 'GNOME', session: 'gnome', wayland: true, greeter: 'gdm',
    marker: ['services.desktopManager.gnome.enable',
             'services.xserver.desktopManager.gnome.enable'],
    roles: [
    ['services.xserver.enable'],
    ['services.displayManager.gdm.enable',
     'services.xserver.displayManager.gdm.enable'],
    ['services.desktopManager.gnome.enable',
     'services.xserver.desktopManager.gnome.enable'],
  ] },
  plasma: { label: 'KDE Plasma', session: 'plasma', wayland: true, greeter: 'sddm',
    marker: ['services.desktopManager.plasma6.enable',
             'services.desktopManager.plasma5.enable',
             'services.xserver.desktopManager.plasma5.enable'],
    roles: [
    ['services.xserver.enable'],
    ['services.displayManager.sddm.enable',
     'services.xserver.displayManager.sddm.enable'],
    ['services.desktopManager.plasma6.enable',
     'services.desktopManager.plasma5.enable',
     'services.xserver.desktopManager.plasma5.enable'],
  ] },
  xfce: { label: 'Xfce', session: 'xfce', wayland: false, greeter: 'lightdm',
    marker: ['services.desktopManager.xfce.enable',
             'services.xserver.desktopManager.xfce.enable'],
    roles: [
    ['services.xserver.enable'],
    ['services.displayManager.lightdm.enable',
     'services.xserver.displayManager.lightdm.enable'],
    ['services.desktopManager.xfce.enable',
     'services.xserver.desktopManager.xfce.enable'],
  ] },
  // Cinnamon has not moved out of services.xserver, the way xfce has not.
  // lightdm is the greeter it is normally paired with.
  cinnamon: { label: 'Cinnamon', session: 'cinnamon', wayland: false, greeter: 'lightdm',
    marker: ['services.desktopManager.cinnamon.enable',
             'services.xserver.desktopManager.cinnamon.enable'],
    roles: [
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
  cosmic: { label: 'COSMIC', wayland: true, greeter: 'cosmic-greeter',
    marker: ['services.desktopManager.cosmic.enable'],
    roles: [
    ['services.displayManager.cosmic-greeter.enable'],
    ['services.desktopManager.cosmic.enable'],
  ] },
  // LXQt is X11 and, like xfce and cinnamon, never left services.xserver.
  // sddm is the greeter its own documentation pairs it with.
  lxqt: { label: 'LXQt', session: 'lxqt', wayland: false, greeter: 'sddm',
    marker: ['services.desktopManager.lxqt.enable',
             'services.xserver.desktopManager.lxqt.enable'],
    roles: [
    ['services.xserver.enable'],
    ['services.displayManager.sddm.enable',
     'services.xserver.displayManager.sddm.enable'],
    ['services.desktopManager.lxqt.enable',
     'services.xserver.desktopManager.lxqt.enable'],
  ] },
  /* i3 is a window manager rather than a desktop: X, a greeter, and i3 on top
     — and nothing else, because what a tiling setup looks like is the user's
     to write. It comes up with an empty screen and its own first-run wizard. */
  i3: { label: 'i3', session: 'none+i3', wayland: false, greeter: 'lightdm',
    marker: ['services.xserver.windowManager.i3.enable'],
    roles: [
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
  /* `hyprland-uwsm` rather than `hyprland`, and `withUWSM` with it. UWSM is
     what starts `graphical-session.target`, and without that target the
     noctalia unit below is written but never runs — Hyprland is the one of
     the three that does not reach it on its own. Both session names register
     (checked with sessionNames), so naming the uwsm one is a choice between
     two real sessions, not a guess. */
  hyprland: { label: 'Hyprland', session: 'hyprland-uwsm', wayland: true, greeter: 'sddm',
    marker: ['programs.hyprland.enable'],
    roles: [
    ['programs.hyprland.enable'],
    ['programs.hyprland.withUWSM'],
    ['programs.hyprland.xwayland.enable'],
    ['services.displayManager.sddm.enable',
     'services.xserver.displayManager.sddm.enable'],
    ['services.displayManager.sddm.wayland.enable'],
  ],
    autostart: 'noctalia-shell',
    packages: ['noctalia-shell', 'kitty'],
    note: 'sddm goes in with it, in Wayland mode, so the machine boots to a ' +
          'login screen, and XWayland is switched on for X11 applications. ' +
          'UWSM is on and the session is hyprland-uwsm: that is what starts ' +
          'graphical-session.target, which the noctalia unit is bound to. ' +
          'kitty is the terminal — Hyprland ships none, and its default ' +
          'keybinding asks for kitty by name. Delete any of them if you start ' +
          'from a text console or use greetd instead. On the first login ' +
          'Hyprland writes its own config into your home and puts a warning at ' +
          'the top of the screen saying so — that banner is Hyprland, not a ' +
          'failure, and nothing here can remove it: delete the line holding ' +
          'autogenerated = true from that file and it goes. SUPER+Q opens the ' +
          'terminal, SUPER+R the runner.',
    note_ja: 'ログイン画面として sddm を Wayland モードで入れてあります。' +
             '起動するとログイン画面が出て、セッション一覧に Hyprland が' +
             '並びます。X11 のアプリ用に XWayland も有効にしました。これは' +
             '元々の既定値でもありますが、どちらに設定されているかがカードで' +
             '分かるように明示しています。UWSM を有効にし、セッションは ' +
             'hyprland-uwsm にしました。graphical-session.target を張るのが ' +
             'UWSM で、noctalia の user service はその target に紐づくためです。' +
             '端末は kitty です。Hyprland は端末を1つも持たず、既定のキー' +
             '割り当てが名指しで kitty を開こうとするためです。テキスト' +
             'コンソールから起動する場合や greetd を使う場合は、該当の' +
             'カードを削除してください。なお初回ログイン時、Hyprland は' +
             '自分の設定ファイルをホームに書き出し、画面上部に「自動生成された' +
             '設定です」という警告を出します。これは Hyprland が出しているもので' +
             '故障ではなく、ここの設定では消せません。そのファイルの ' +
             'autogenerated = true の行を削除すれば消えます。端末は SUPER+Q、' +
             'ランチャーは SUPER+R です。' },
  /* A compositor is a compositor and nothing else — no panel, no launcher, no
     notifications — so all three Wayland ones bring noctalia-shell, which is
     the piece that puts those on top. It is a package rather than a setting:
     nothing in the option catalogue mentions it. Added as an ordinary line in
     environment.systemPackages, which the status bar says and the card shows,
     so it can be taken out like anything else. */
  niri: { label: 'niri + noctalia', session: 'niri', wayland: true, greeter: 'sddm',
    marker: ['programs.niri.enable'],
    roles: [
    ['programs.niri.enable'],
    ['services.displayManager.sddm.enable',
     'services.xserver.displayManager.sddm.enable'],
    ['services.displayManager.sddm.wayland.enable'],
  ],
    autostart: 'noctalia-shell',
    keyring: true,
    packages: ['noctalia-shell', 'xwayland-satellite', 'foot'],
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
  sway: { label: 'Sway + noctalia', session: 'sway', wayland: true, greeter: 'sddm',
    marker: ['programs.sway.enable'],
    roles: [
    ['programs.sway.enable'],
    ['programs.sway.xwayland.enable'],
    ['services.displayManager.sddm.enable',
     'services.xserver.displayManager.sddm.enable'],
    ['services.displayManager.sddm.wayland.enable'],
  ],
    autostart: 'noctalia-shell',
    keyring: true,
    etc: { 'sway/config': SWAY_CONFIG_NO_BAR },
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

/* Has an input method actually been chosen? A `null or one of …` option can be
   present and still say nothing — the form holds it as `{ __null: true }` and
   it renders as `type = null;`, which reads like a decision on the page and is
   not one. So this asks what the entry holds, never merely whether it is
   there. */
function imChosen(path) {
  const e = findEntry(path);
  if (!e) return false;
  const v = e.value;
  if (v === null || v === undefined) return false;
  if (typeof v === 'object' && v.__null) return false;
  return String(typeof v === 'object' ? (v.v ?? '') : v).trim() !== '';
}

/* An enabled input method with nothing chosen is the crash, not a state to
   warn about and leave standing: the module pushes a null package and
   `nixos-rebuild` dies with `not of type 'package'`, pointing at systemd
   rather than at the cause. Japanese, Korean and Chinese cannot be typed
   without one, so fcitx5 goes in — the engine those three presets already
   use, and the one whose addons the form knows how to fill.

   It only ever fills a blank. A type that says ibus, or kime, or anything
   else is somebody's choice and is left alone. A release without the option
   gets nothing written rather than a line that fails later, and the warning
   in `doRender` stays as the last resort for that case. */
async function ensureImType() {
  if (!findEntry('i18n.inputMethod.enable')) return null;
  if (imChosen('i18n.inputMethod.type') || imChosen('i18n.inputMethod.enabled')) return null;
  return await addWithValue(['i18n.inputMethod.type', 'i18n.inputMethod.enabled'],
                            'fcitx5');
}

/* Every display manager a preset can put in the module. NixOS refuses two at
   once — gdm's module force-disables the others, so a leftover lightdm from
   the previous desktop is `conflicting definition values` at build time,
   proven by evaluating exactly that. Switching desktops therefore removes the
   greeters that are not the new desktop's, and sddm takes its wayland switch
   with it. Only these paths are ever touched; a greeter somebody added by
   hand under another name is not nixgen's to remove. */
const GREETERS = {
  gdm: ['services.displayManager.gdm.enable',
        'services.xserver.displayManager.gdm.enable'],
  sddm: ['services.displayManager.sddm.enable',
         'services.xserver.displayManager.sddm.enable',
         'services.displayManager.sddm.wayland.enable'],
  lightdm: ['services.displayManager.lightdm.enable',
            'services.xserver.displayManager.lightdm.enable'],
  'cosmic-greeter': ['services.displayManager.cosmic-greeter.enable'],
};

/* A compositor brings a shell, and a shell nobody starts is a package sitting
   in the store. The three Wayland ones get a user service bound to
   `graphical-session.target`, which every one of them reaches: sway's default
   config execs `systemctl --user start sway-session.target` and that target
   `bindsTo` it, niri ships its own units, and Hyprland gets there through
   UWSM — which is why its preset asks for `withUWSM` and names the
   `hyprland-uwsm` session. All three were evaluated with this unit in place.

   `systemd.user.services` is `attribute set of (submodule)`, so the form has
   no widget for it and holds it the way `nix.settings` is held: one key per
   service, each a line of Nix source. That is also why the writes below merge
   rather than assign — the card may already hold somebody else's service.

   **The PATH is the whole reason the launcher works.** NixOS gives a user
   service `Environment="PATH=coreutils:findutils:…"` and nothing else, so
   noctalia came up but could not spawn anything it listed — reported from a
   real machine. nixpkgs' own niri module sets `enableDefaultPath = false` for
   exactly this ("breaking spawn actions that rely on it"), but dropping the
   default only helps where the session put a usable PATH into the user
   manager, and the three do not agree: niri-session imports one, sway imports
   only DISPLAY/WAYLAND_DISPLAY/SWAYSOCK, and Hyprland's `systemd.setPath` is
   off by default above 0.41.2. So the PATH is named outright, using the same
   list Hyprland's module uses against the same symptom. */
const AUTOSTART_UNIT = `{
      description = "Noctalia shell";
      enableDefaultPath = false;
      partOf = [ "graphical-session.target" ];
      after = [ "graphical-session.target" ];
      wantedBy = [ "graphical-session.target" ];
      serviceConfig = {
        Environment = [
          "PATH=/run/wrappers/bin:/etc/profiles/per-user/%u/bin:/nix/var/nix/profiles/default/bin:/run/current-system/sw/bin"
        ];
        ExecStart = "\${pkgs.noctalia-shell}/bin/noctalia-shell";
        Restart = "on-failure";
      };
    }`;

const AUTOSTART_PATH = 'systemd.user.services';


// Every service name a preset writes, so one can be recognised and removed
// without having to match the text of the unit it holds.
const AUTOSTART_NAMES = ['noctalia-shell'];

/* One service reaches the module in two shapes, and they collide. Written by
   the preset it is one attrs card holding `noctalia-shell = { … }`; read back
   out of a file it arrives flattened, one card per leaf —
   `systemd.user.services.noctalia-shell.after`, `.description`, and so on.
   Nix will not take both: `attribute
   'systemd.user.services.noctalia-shell.after' already defined`, which Check
   syntax cannot see because it is an evaluation error, not a syntax one. It
   reached a real machine that way. So both shapes are recognised, and writing
   the card clears the leaves first. */
function autostartEntries(name) {
  const leaf = `${AUTOSTART_PATH}.${name}.`;
  return [...state.selected].filter(([, e]) => {
    const path = resolvePath(e);
    return path === AUTOSTART_PATH || path.startsWith(leaf);
  });
}

/* Write our one key into the attrs card, leaving every other key alone. */
async function addAutostart(name) {
  // Any flattened copy of this service goes first, or the file defines it twice.
  for (const [key, e] of autostartEntries(name)) {
    if (resolvePath(e) !== AUTOSTART_PATH) state.selected.delete(key);
  }
  const existing = findEntry(AUTOSTART_PATH);
  const keys = existing && existing.value && typeof existing.value === 'object'
    ? { ...existing.value } : {};
  keys[name] = AUTOSTART_UNIT;
  return await addWithValue([AUTOSTART_PATH], keys);
}

/* And take it out again when the new desktop does not want it — the same rule
   the greeters follow. Both shapes go: the key inside the attrs card, and the
   flattened cards an import produced. A card left holding nothing goes too,
   rather than rendering as an empty attribute set.

   The value is not compared against `AUTOSTART_UNIT` any more. A unit that has
   been through a file and back does not match it character for character, and
   that is exactly the copy that survived a desktop switch and then collided
   with a freshly written one. The name is what identifies it. */
function dropAutostart(keep) {
  const gone = [];
  for (const name of AUTOSTART_NAMES) {
    if (name === keep) continue;
    for (const [key, e] of autostartEntries(name)) {
      if (resolvePath(e) !== AUTOSTART_PATH) { state.selected.delete(key); gone.push(name); }
    }
    const e = findEntry(AUTOSTART_PATH);
    if (e && e.value && typeof e.value === 'object' && name in e.value) {
      delete e.value[name];
      gone.push(name);
    }
  }
  const card = findEntry(AUTOSTART_PATH);
  if (card && card.value && typeof card.value === 'object'
      && !Object.keys(card.value).length) {
    for (const [key, entry] of [...state.selected]) {
      if (resolvePath(entry) === AUTOSTART_PATH) state.selected.delete(key);
    }
  }
  return [...new Set(gone)];
}

/* A desktop's packages are part of the desktop. Leaving noctalia-shell,
   xwayland-satellite and foot in `environment.systemPackages` after switching
   to GNOME installs three things nothing on the machine uses — reported after
   the unit itself was being removed correctly, which made the leftovers the
   visible half.

   Only names a `DESKTOPS` preset puts there are candidates, and only when the
   desktop being chosen does not want them too — noctalia-shell belongs to all
   three compositors, so going between them must not take it out and put it
   back. The terminals differ: niri's default config is happy with foot, and
   Hyprland's asks for kitty by name, which is why each names its own.
   A name the user typed into the card themselves is indistinguishable from
   one a preset wrote, so the status bar says what went — the same courtesy the
   greeters get. */
const PRESET_PACKAGES = [...new Set(
  Object.values(DESKTOPS).flatMap(d => d.packages || []))];

function dropPresetPackages(keep) {
  const wanted = new Set((DESKTOPS[keep] && DESKTOPS[keep].packages) || []);
  const gone = PRESET_PACKAGES.filter(a => !wanted.has(a) && alreadyListed(a));
  if (!gone.length) return [];
  const e = findEntry(TOP_OPTION);
  if (Array.isArray(e.value)) {
    e.value = e.value.filter(x => !gone.includes(String(x).replace(/^pkgs\./, '')));
  } else {
    /* The list came in verbatim, so it is text: drop each name where it stands
       and leave every other element, and the spacing, as they were. */
    let text = String(e.value || '');
    for (const a of gone) {
      text = text.replace(
        new RegExp('(^|[\\s\\[])(?:pkgs\\.)?' + rxEscape(a) + '(?=[\\s\\]]|$)', 'g'),
        '$1').replace(/[ \t]+\n/g, '\n');
    }
    e.value = text;
  }
  gone.forEach(a => state.unfree.delete(a));
  return gone;
}

/* The same merge-don't-assign rule as the autostart unit: `environment.etc` is
   one attrs card and somebody else's file may be in it. Keyed by the etc path,
   so a desktop switch takes out only what its own preset put there. */
/* A compositor has no secret service: browsers and anything else that stores
   credentials needs gnome-keyring, and a keyring nobody unlocks asks for a
   second password at every login. `services.gnome.gnome-keyring.enable`
   installs the daemon. The PAM half goes on the *login* service, not sddm's:
   sddm's stack is one `include login` line — read out of the built
   pam.d/sddm after `security.pam.services.sddm.enableGnomeKeyring` turned
   out to change nothing — so the login switch is the one that puts the
   auth/password/session pam_gnome_keyring lines in place, and the keyring
   opens with the login password. GNOME and Plasma wire their own keyring, so
   the pair leaves when the desktop does. */
const KEYRING_ENABLE = 'services.gnome.gnome-keyring.enable';
const KEYRING_PAM = ['security', 'pam', 'services', 'login', 'enableGnomeKeyring'];

const ETC_KEYS = [...new Set(
  Object.values(DESKTOPS).flatMap(d => Object.keys(d.etc || {})))];

/* A raw card at an exact attribute path, shaped like the ones an import
   builds. The presets write these instead of one card holding a whole
   attribute set, and the collision that forced the change is worth spelling
   out: an attrs card `environment.etc = { … }` beside a flattened
   `environment.etc."sway/config".source` card — which is exactly what reading
   a file back in produces — is `attribute … already defined` at
   `nixos-rebuild`. It reached a real machine through the recovery path this
   tool itself suggested. A flat line collides with nothing: NixOS merges
   sibling paths across cards, and the same line read back in becomes the same
   card, so the shape survives the round trip that broke the attrs form. */
/* Our key may also be sitting inside an ancestor attrs card — the same
   two-shapes collision one level up. Reading a file back in folds a flat
   `environment.sessionVariables.XKB_DEFAULT_LAYOUT = …` line into an attrs
   card on `environment.sessionVariables`, so writing the flat line again
   beside that card defines the leaf twice, and `nixos-rebuild` refuses the
   file. It reached a real machine exactly that way. The key comes out of the
   ancestor; the ancestor's other keys stay; an emptied card goes. */
function dropFromAncestors(segments) {
  let touched = false;
  for (let k = segments.length - 1; k >= 1; k--) {
    const aPath = segments.slice(0, k).join('.');
    for (const [key, e] of [...state.selected]) {
      if (resolvePath(e) !== aPath) continue;
      if (e.value && typeof e.value === 'object' && !Array.isArray(e.value)
          && Object.prototype.hasOwnProperty.call(e.value, segments[k])) {
        delete e.value[segments[k]];
        touched = true;
        if (!Object.keys(e.value).length) state.selected.delete(key);
      }
    }
  }
  return touched;
}

function setRawCard(segments, source, label) {
  const path = segments.join('.');
  for (const [key, e] of [...state.selected]) {
    const q = resolvePath(e);
    if (q === path || q.startsWith(path + '.')) state.selected.delete(key);
  }
  dropFromAncestors(segments);
  state.selected.set(path, {
    path,
    segments,
    type: { kind: 'raw', label },
    type_str: label,
    description: '',
    default_txt: null,
    slots: [],
    value: source,
  });
  return path;
}

function dropRawCard(segments) {
  const path = segments.join('.');
  let gone = false;
  for (const [key, e] of [...state.selected]) {
    const q = resolvePath(e);
    if (q === path || q.startsWith(path + '.')) {
      state.selected.delete(key);
      gone = true;
    }
  }
  if (dropFromAncestors(segments)) gone = true;
  return gone;
}

function addEtc(files) {
  let wrote = null;
  for (const [name, src] of Object.entries(files)) {
    wrote = setRawCard(['environment', 'etc', name, 'source'], src,
                       'path — written verbatim into the file');
  }
  return wrote;
}

function dropEtc(keep) {
  const wanted = new Set(Object.keys(keep || {}));
  const gone = [];
  for (const name of ETC_KEYS) {
    if (wanted.has(name)) continue;
    if (dropRawCard(['environment', 'etc', name, 'source'])) gone.push(name);
  }
  return gone;
}

function dropOtherGreeters(keep) {
  const dropped = [];
  for (const [name, paths] of Object.entries(GREETERS)) {
    if (name === keep) continue;
    for (const p of paths) {
      for (const [key, e] of [...state.selected]) {
        if (resolvePath(e) === p) {
          state.selected.delete(key);
          dropped.push(p);
        }
      }
    }
  }
  return dropped;
}

/* The desktop the module holds, read from the module rather than remembered:
   the shared roles (the X server, sddm, defaultSession) cannot tell desktops
   apart, so each entry names the option that is its own. */
function pickedDesktop() {
  for (const d of Object.values(DESKTOPS)) {
    if ((d.marker || []).some(p => findEntry(p))) return d;
  }
  return null;
}

/* fcitx5 has two front ends, and the wrong one half-works: with the X11 one
   on a Wayland session, GTK_IM_MODULE forces the legacy path and native
   Wayland apps misbehave. `waylandFrontend = true` drops those variables so
   apps use the text-input protocol — read out of two evaluated systems, not
   assumed. This keeps the input method's front end matched to the session of
   whichever desktop the module holds. */
async function syncImFrontend(added) {
  const d = pickedDesktop();
  if (!d || typeof d.wayland !== 'boolean') return false;
  const im = findEntry('i18n.inputMethod.fcitx5.addons') ||
             findEntry('i18n.inputMethod.type') ||
             findEntry('i18n.inputMethod.enabled');
  if (!im) return false;
  const used = await addWithValue(['i18n.inputMethod.fcitx5.waylandFrontend'],
                                  d.wayland);
  if (used) added.push(used);
  return !!used;
}

async function addDesktop(key) {
  const d = DESKTOPS[key];
  if (!d) return;
  const dropped = dropOtherGreeters(d.greeter);
  dropAutostart(d.autostart);
  dropEtc(d.etc);
  const droppedPkgs = dropPresetPackages(key);
  const added = [], missing = [];
  for (const candidates of d.roles) {
    const used = await addWithValue(candidates, true);
    used ? added.push(used) : missing.push(candidates[0]);
  }
  /* Pre-select this desktop on the login screen. The names are not guessed:
     each system was evaluated and its session list read back — gnome, plasma,
     xfce, cinnamon, lxqt, hyprland, sway, niri, and i3's is `none+i3`. NixOS
     asserts the name against that same list at evaluation time, so a wrong
     one would fail the build rather than fall back. Picking another desktop
     later updates the value in place, because addWithValue writes into an
     existing card instead of adding a second.

     COSMIC has no `session` on purpose: defaultSession only speaks to GDM,
     LightDM and SDDM, and COSMIC boots through its own greeter — which shows
     the one session it has anyway. The option is `null or session name` with
     a raw inside, so the value is Nix source and arrives quoted. */
  if (d.session) {
    const used = await addWithValue(['services.displayManager.defaultSession'],
                                    JSON.stringify(d.session));
    used ? added.push(used) : missing.push('services.displayManager.defaultSession');
  }
  const imSynced = await syncImFrontend(added);
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
  /* Written only when the package it starts actually came back: a unit whose
     ExecStart points at a package this channel does not have would fail at
     nixos-rebuild, which is the one thing these presets must not produce. */
  let etced = null;
  if (d.etc) {
    etced = addEtc(d.etc);
    if (etced) added.push(etced);
  }
  let keyringed = false;
  if (d.keyring) {
    const kr = await addWithValue([KEYRING_ENABLE], true);
    if (kr) added.push(kr);
    added.push(setRawCard(KEYRING_PAM, 'true', 'boolean'));
    keyringed = !!kr;
  } else {
    for (const [key, e] of [...state.selected]) {
      if (resolvePath(e) === KEYRING_ENABLE) state.selected.delete(key);
    }
    dropRawCard(KEYRING_PAM);
  }
  let autostarted = null;
  if (d.autostart && pkgs.includes(d.autostart)) {
    autostarted = await addAutostart(d.autostart);
    if (autostarted) added.push(autostarted);
    else missing.push(AUTOSTART_PATH);
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
    const extra = (pkgs.length
      ? ` ${pkgs.join(', ')} went into environment.systemPackages with it.` : '')
      + (imSynced
      ? ` The input method's Wayland frontend now matches this session` +
        ` (${d.wayland ? 'on' : 'off'}).` : '')
      + (dropped.length
      ? ` The previous desktop's display manager came out ` +
        `(${dropped.join(', ')}) — NixOS refuses two at once.` : '')
      + (autostarted
      ? ` ${d.autostart} starts with the session, through a user service bound ` +
        `to graphical-session.target.` : '')
      + (droppedPkgs.length
      ? ` The previous desktop's own packages came out of ` +
        `environment.systemPackages (${droppedPkgs.join(', ')}).` : '')
      + (etced
      ? ` /etc/sway/config is replaced with the package's own minus its ` +
        `swaybar block, so the only bar on screen is noctalia's.` : '')
      + (keyringed
      ? ` gnome-keyring is set up and PAM opens it with your login password, ` +
        `so applications can store credentials.` : '');
    const extraJa = (pkgs.length
      ? `あわせて ${pkgs.join('、')} を environment.systemPackages に入れました。` : '')
      + (imSynced
      ? `入力メソッドの Wayland フロントエンドも、このセッションに合わせて` +
        `${d.wayland ? '有効' : '無効'}にしました。` : '')
      + (dropped.length
      ? `前のデスクトップのディスプレイマネージャ(${dropped.join('、')})は` +
        `外しました。NixOS は2つ同時を受け付けません。` : '')
      + (autostarted
      ? `${d.autostart} は graphical-session.target に紐づけた user service で、` +
        `セッションと一緒に起動します。` : '')
      + (droppedPkgs.length
      ? `前のデスクトップ専用のパッケージ(${droppedPkgs.join('、')})は ` +
        `environment.systemPackages から外しました。` : '')
      + (etced
      ? `/etc/sway/config は、パッケージ同梱のものから swaybar のブロックだけを` +
        `除いたものに差し替えました。画面に出るバーは noctalia のものだけに` +
        `なります。` : '')
      + (keyringed
      ? `gnome-keyring も設定し、PAM がログインパスワードで開くようにしました。` +
        `アプリが資格情報を保存できます。` : '');
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

/* Where the machine is, which the language deliberately does not decide: a
   language is not a place, so `time.timeZone` was left out of the language
   preset and is its own row. Every name here was checked against the zoneinfo
   database in the store rather than typed from memory — a wrong one is
   accepted by the form and only shows up as a clock that is silently wrong.

   `time.timeZone` is `null or string without spaces`, so the form holds it as
   a nullable and the value is a plain string. The list is short on purpose,
   like every other preset: the search box reaches the other ~600. */
const REGIONS = {
  'Asia/Tokyo':          'Japan — 日本',
  'Asia/Seoul':          'Korea — 韓国',
  'Asia/Shanghai':       'China — 中国',
  'Asia/Taipei':         'Taiwan — 台湾',
  'Asia/Singapore':      'Singapore — シンガポール',
  'Asia/Kolkata':        'India — インド',
  'Australia/Sydney':    'Sydney — シドニー',
  'Pacific/Auckland':    'New Zealand — ニュージーランド',
  'Europe/London':       'UK — イギリス',
  'Europe/Paris':        'France — フランス',
  'Europe/Berlin':       'Germany — ドイツ',
  'Europe/Madrid':       'Spain — スペイン',
  'America/New_York':    'US East — アメリカ東部',
  'America/Chicago':     'US Central — アメリカ中部',
  'America/Denver':      'US Mountain — アメリカ山岳部',
  'America/Los_Angeles': 'US West — アメリカ西部',
  'America/Sao_Paulo':   'Brazil — ブラジル',
  'UTC':                 'UTC — 協定世界時',
};

async function addRegion(zone) {
  if (!REGIONS[zone]) return;
  const used = await addWithValue(['time.timeZone'], zone);
  renderEditor();
  pushRender();
  if (!used) {
    return setStatus(say(
      `This release has no time.timeZone.`,
      `このリリースには time.timeZone がありません。`), 'bad');
  }
  setStatus(say(
    `Time zone set to ${zone}. The clock and anything that stamps a time ` +
    `follow it; your language and keyboard are set separately.`,
    `タイムゾーンを ${zone} にしました。時計や時刻を記録するものはこれに従います。` +
    `言語とキーボードは別に設定します。`), 'ok');
}

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

  const added = [], missing = [];
  for (const step of steps) {
    const used = await addWithValue(step.paths, step.value);
    used ? added.push(used) : missing.push(step.paths[0]);
  }

  /* `services.xserver.xkb.layout` reaches the X server and the desktops that
     read it — and the wlroots compositors read none of it, which is how a
     machine set to Japanese logged into sway with a US keyboard. Their
     keymaps come from libxkbcommon, whose fallback when no layout is
     configured is the XKB_DEFAULT_LAYOUT environment variable (checked in the
     library itself). `environment.sessionVariables` is set by PAM at login,
     so it reaches the session however it is started. A flat card, for the
     same reason the sway config is one: an attrs card here collides with a
     flattened sessionVariables line read in from a file.

     Hyprland is the exception and gets a note instead: its generated config
     writes `kb_layout = us` outright, and a config line beats the
     environment. */
  added.push(setRawCard(['environment', 'sessionVariables', 'XKB_DEFAULT_LAYOUT'],
                        JSON.stringify(L.xkb), 'string'));

  /* The input method is enabled and chosen as one unit — that is the whole fix
     for the crash where it was two. `i18n.inputMethod` has two interfaces:
     the new one (`enable = true` plus `type = "fcitx5"`, 24.05 onward) and the
     old one (`enabled = "fcitx5"` alone). The module reads `type` to decide
     which package goes into `environment.systemPackages`; if `enable` is on
     and `type` is unset, it pushes a null package and the build dies with
     `not of type 'package'`.

     So the choice is written FIRST, and whether to write `enable` depends on
     which interface answered. The new interface gets `enable`; the old one
     does not have it and must not (it would be an unknown option). A channel
     with neither is one where the input method cannot be set, and nothing is
     written — never a lone `enable`. */
  let imOk = false;
  if (L.im) {
    const sel = await addWithValue(
      ['i18n.inputMethod.type', 'i18n.inputMethod.enabled'], L.im);
    if (sel) {
      imOk = true;
      added.push(sel);
      if (sel === 'i18n.inputMethod.type') {
        const en = await addWithValue(['i18n.inputMethod.enable'], true);
        en ? added.push(en) : missing.push('i18n.inputMethod.enable');
      }
      const addons = await addWithValue(['i18n.inputMethod.fcitx5.addons'], L.addons);
      if (addons) added.push(addons);
      // Match the front end to the desktop's session if one is already picked;
      // otherwise picking a desktop later sets it (addDesktop re-syncs).
      const d = pickedDesktop();
      if (d && typeof d.wayland === 'boolean') {
        const fe = await addWithValue(
          ['i18n.inputMethod.fcitx5.waylandFrontend'], d.wayland);
        if (fe) added.push(fe);
      }
    } else {
      missing.push('i18n.inputMethod.type');
    }
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

$('#btn-region').addEventListener('click', () => {
  const zone = $('#s-region').value;
  if (zone) addRegion(zone);
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

  /* The previous card's pieces leave when the card does, the same rule the
     desktops follow — without this, NVIDIA -> AMD kept
     `services.xserver.videoDrivers = ["nvidia"]` and the hardware.nvidia
     cards, which is still an NVIDIA configuration wearing an AMD label, and
     with `allowUnfree` gone it stops building outright. Only values this
     preset wrote are touched: a videoDrivers card holding anything but
     exactly ["nvidia"] is the user's and stays. */
  const dropIfOurs = (path, value) => {
    for (const [key, e] of [...state.selected]) {
      if (resolvePath(e) !== path) continue;
      // A nullable option wraps its value ({__null, v}); compare what it
      // holds, or hardware.nvidia.open = false never matches false and the
      // card survives every switch — which is how this line got here.
      let v = e.value;
      if (v && typeof v === 'object' && !Array.isArray(v) && '__null' in v) {
        v = v.__null ? null : v.v;
      }
      if (value === undefined
          || JSON.stringify(v) === JSON.stringify(value)) {
        state.selected.delete(key);
      }
    }
  };
  if (!g.nvidia) {
    dropIfOurs('hardware.nvidia.modesetting.enable', true);
    dropIfOurs('hardware.nvidia.open', false);
    dropIfOurs('services.xserver.videoDrivers', ['nvidia']);
  }
  if (key !== 'intel') {
    dropIfOurs('hardware.graphics.extraPackages', ['intel-media-driver']);
  }

  const added = [], missing = [];
  for (const step of steps) {
    const used = await addWithValue(step.paths, step.value);
    used ? added.push(used) : missing.push(step.paths[0]);
  }

  /* The NVIDIA driver is unfree, and a file that names it without
     `allowUnfree` fails at nixos-rebuild with a refusal three screens long —
     the one thing this preset produced that could not build as written. So
     the switch goes in with the driver. A flat card, since `nixpkgs.config`
     is an attrs option the form has no widget for.

     Switching to AMD or Intel takes it out again ONLY when nothing else
     needs it: vscode, Steam and their like are unfree too, and the card may
     be the only thing letting them build. `state.unfree` knows what the UI
     added; anything it still finds in the list keeps the card, and the
     status bar says which way it went. */
  let unfreeCard = null;
  if (g.nvidia) {
    unfreeCard = setRawCard(['nixpkgs', 'config', 'allowUnfree'], 'true', 'boolean');
    added.push(unfreeCard);
  } else {
    const stillNeeded = [...state.unfree].filter(a => alreadyListed(a));
    if (!stillNeeded.length) {
      if (dropRawCard(['nixpkgs', 'config', 'allowUnfree'])) unfreeCard = 'dropped';
    } else {
      unfreeCard = 'kept:' + stillNeeded.join(', ');
    }
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
    const extra =
      g.nvidia
        ? ' nixpkgs.config.allowUnfree = true went in with it — the driver ' +
          'is unfree and the build refuses it otherwise.'
        : unfreeCard === 'dropped'
          ? ' allowUnfree came out again: nothing unfree is left in the module.'
          : unfreeCard && unfreeCard.startsWith('kept:')
            ? ` allowUnfree stays: ${unfreeCard.slice(5)} still needs it.`
            : '';
    const extraJa =
      g.nvidia
        ? 'ドライバが unfree のため nixpkgs.config.allowUnfree = true も' +
          '入れました。無いとビルドが拒否されます。'
        : unfreeCard === 'dropped'
          ? 'unfree なものが残っていないので、allowUnfree は外しました。'
          : unfreeCard && unfreeCard.startsWith('kept:')
            ? `${unfreeCard.slice(5)} が使うため、allowUnfree は残しています。`
            : '';
    setStatus(say(`${g.label}: ${added.length} settings added.${extra}`,
                  `${g.label}: ${added.length}件の設定を追加しました。${extraJa}`), 'ok');
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
  /* Before the file is written, not after: an input method enabled with
     nothing chosen is filled in here, so every route into that state — the
     search box, either import, editing a card back to null — comes out with a
     usable file rather than a warning about a broken one. It is a no-op the
     moment a type is set, so this does not run twice or loop. */
  const imFilled = await ensureImType();
  if (imFilled) renderEditor();
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
      body: JSON.stringify({ entries, channel: state.channel, build: BUILD }),
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
  /* One card holding an attribute set and another holding a leaf inside it is
     only a problem when the same key is in both: `nix.settings = { cores = 8; }`
     beside `nix.settings.cores` is `attribute … already defined`, while the
     same block beside `nix.settings.max-jobs` is ordinary Nix that parses and
     builds — proven by evaluating both. The first version of this check
     compared paths alone and flagged the legal shape too; a real import (the
     catalogue holds `nix.settings.cores` as its own option, so a file's flat
     lines come back as leaf cards beside the folded attrs card) warned about
     a file that built fine. So the key is what is tested: the leaf's next
     segment must actually appear inside the ancestor's value — as a key when
     the value is the form's object, by pattern when it is verbatim source. */
  const entriesByPath = new Map();
  for (const e of state.selected.values()) entriesByPath.set(resolvePath(e), e);
  const paths = [...entriesByPath.keys()];
  const nested = paths.filter(p => paths.some(q => {
    if (q === p || !p.startsWith(q + '.')) return false;
    const anc = entriesByPath.get(q);
    const key = segmentsFor(entriesByPath.get(p))[segmentsFor(anc).length];
    if (!anc || key === undefined) return false;
    const v = anc.value;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.prototype.hasOwnProperty.call(v, key);
    }
    if (typeof v === 'string') {
      return new RegExp('(^|[\\s{;])' + rxEscape(key) + '\\s*=').test(v);
    }
    return false;
  }));
  if (nested.length) {
    notes.push(say(
      `Defined inside another card as well: ${nested.join(', ')}. Nix refuses ` +
      `a file that defines one attribute twice, so the build fails. Remove ` +
      `whichever of the two you do not want.`,
      `別のカードの中でも定義されています: ${nested.join('、')}。Nix は同じ属性を` +
      `2回定義したファイルを拒否するので、ビルドが失敗します。不要なほうを` +
      `削除してください。`));
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
  /* Both unfree notes stand down once the module really sets the switch —
     an instruction to add a line that is already on screen reads as a bug.
     The check is on the rendered text, so a verbatim or ancestor-card
     spelling counts too. */
  const unfreeAllowed = /allowUnfree\s*=\s*true/.test(res.text);
  const unfree = [...state.unfree].filter(a => res.text.includes('pkgs.' + a));
  if (unfree.length && !unfreeAllowed) {
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
  if (/^\s*hardware\.nvidia\./m.test(res.text) && !unfreeAllowed) {
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
  /* The input method must not be enabled without a type chosen. The language
     preset now guarantees they arrive together, but the option is reachable
     from the search box on its own, and a file read in could carry it — so
     this is the catch-all. Enabled with no `type`/`enabled` makes the module
     push a null package into environment.systemPackages, and the build dies
     with `not of type 'package'`, far from the cause. */
  /* `ensureImType` has already filled a blank type by the time this runs, so
     reaching here means it could not: the option is not in this release, and
     the file would fail at `nixos-rebuild` with `not of type 'package'`. */
  if (findEntry('i18n.inputMethod.enable') &&
      !imChosen('i18n.inputMethod.type') &&
      !imChosen('i18n.inputMethod.enabled')) {
    notes.push(say(
      'i18n.inputMethod.enable is on but no input method is chosen, and this ' +
      'release has no i18n.inputMethod.type to set. Remove the enable line, or ' +
      'the build fails with "not of type \'package\'" — with no type the module ' +
      'puts a null into environment.systemPackages.',
      'i18n.inputMethod.enable が有効ですが入力メソッドが選ばれておらず、この' +
      'リリースには設定先の i18n.inputMethod.type がありません。enable の行を' +
      '外してください。type が無いとモジュールが environment.systemPackages に ' +
      'null を入れ、"not of type \'package\'" でビルドが失敗します。'));
  } else if (imFilled) {
    notes.push(say(
      `An input method was enabled with nothing chosen, so ${imFilled} is set ` +
      `to fcitx5 — Japanese, Korean and Chinese cannot be typed without one. ` +
      `Change it under Options if you use ibus or another engine.`,
      `入力メソッドが有効なのに何も選ばれていなかったので、${imFilled} を ` +
      `fcitx5 にしました。日本語・韓国語・中国語は入力メソッド無しには打てません。` +
      `ibus など他のエンジンを使う場合は Options タブで変更してください。`));
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
    // The row is hidden because the answer is x86_64 for practically every
    // PC — but a file that says otherwise makes it visible again, so the
    // machine's real architecture is never carried invisibly.
    if (bare !== 'x86_64-linux') $('#s-system-wrap').hidden = false;
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

  /* A configuration.nix splits three ways. The Setup tab takes the fields it
     owns and writes them from there. `imports` is merged into the list the
     starter writes, rather than carried as a line that would define it twice.
     **Everything else becomes cards in the module.**

     That last part used to go into the configuration.nix the Setup tab writes,
     on the reasoning that somebody's own file should not end up inside
     nixgen's. In practice that reasoning did not survive contact: the file
     those lines were copied into is generated by nixgen anyway, so nothing was
     being preserved — and copied text can only be looked at, while a card can
     be edited, searched against the catalogue, and checked for collisions. An
     option this release does not have, or an expression the form cannot hold,
     still arrives as a verbatim card, which is the module's existing shape for
     both. */
  const toSetup = fillSetupFrom(incoming);
  const moved = new Set(toSetup);

  const ownImports = ['./hardware-configuration.nix', './generated.nix'];
  const extraImports = [];
  const forModule = [];
  for (const x of incoming) {
    const path = resolvePath(x.entry);
    if (moved.has(path)) continue;
    if (path === 'imports') {
      splitNixList(String(x.entry.value).replace(/^[^[]*\[/, '').replace(/\][^\]]*$/, ''))
        .filter(p => p && !ownImports.includes(p))
        .forEach(p => extraImports.push(p));
      continue;
    }
    forModule.push(x);
  }
  const carried = [];
  state.carried = carried;
  state.carriedImports = extraImports;
  await intoModule(f, r, forModule, toSetup, {
    extraImports,
    intro: {
      body: 'The Setup tab took the fields it writes; the rest are cards in ' +
            'the module on the right, where you can change them. Your file ' +
            'was only read.',
      body_ja: 'Setup タブが自分で書く項目を受け取り、残りは右の module の' +
               'カードになりました。そちらで変更できます。読み込んだファイルは' +
               '読んだだけです。',
    },
  });
  return;
}


/* What a card holds, as plain text: a raw option's value is Nix source, a
   nullable wraps it, everything else is the value itself. */
function cardText(path) {
  const e = findEntry(path);
  if (!e) return null;
  let v = e.value;
  if (v && typeof v === 'object' && !Array.isArray(v) && '__null' in v) {
    if (v.__null) return null;
    v = v.v;
  }
  if (v === null || v === undefined) return null;
  return String(v).trim().replace(/^"|"$/g, '');
}

/* Read the presets back out of the module and show them in the dropdowns.
   Importing a generated.nix used to fill the cards and leave every dropdown
   on `choose…`, so what the file had chosen was invisible until you read the
   Nix — and re-picking looked like the only way to find out.

   **This selects; it never applies.** The settings are already in the module,
   and `select.value = …` fires no click, so nothing is written. That is the
   whole safety property: a wrong guess here shows a wrong name in a dropdown,
   never a wrong line in the file.

   Each preset is recognised by what it actually wrote, not by a remembered
   choice — the same rule the greeter and package cleanups follow. */
function syncPresetPickers() {
  const found = [];
  const set = (id, key) => {
    if (!key) return;
    const sel = $(id);
    if (!sel || ![...sel.options].some(o => o.value === key)) return;
    sel.value = key;
    found.push(sel.previousElementSibling
      ? sel.previousElementSibling.textContent.split('\n')[0].trim() : id);
  };

  // The desktop already knows how to recognise itself: every entry carries
  // the option that is its own, because the shared roles cannot tell them
  // apart.
  const d = pickedDesktop();
  set('#s-desktop', d && Object.keys(DESKTOPS).find(k => DESKTOPS[k] === d));

  // boot.kernelPackages is Nix source, and LTS is a list of candidates, so
  // every spelling a preset could have written is compared.
  const kern = cardText('boot.kernelPackages');
  if (kern) {
    set('#s-kernel', Object.keys(KERNELS).find(k =>
      KERNELS[k].try.some(t => t.expr === kern)));
  }

  const shell = cardText('users.defaultUserShell');
  if (shell) set('#s-shell', Object.keys(SHELLS).find(k => SHELLS[k].pkg === shell));

  /* Graphics has no single marker. NVIDIA and Intel name themselves; AMD is
     the one that adds nothing of its own, so it is claimed only when both
     lines the preset writes are there — a bare hardware.graphics.enable
     someone added from the search box is not enough to call it an AMD
     machine. */
  const drivers = cardText('services.xserver.videoDrivers') || '';
  const extras = JSON.stringify(findEntry('hardware.graphics.extraPackages')?.value || '');
  if (String(drivers).includes('nvidia') || findEntry('hardware.nvidia.open')) {
    set('#s-gpu', 'nvidia');
  } else if (extras.includes('intel-media-driver')) {
    set('#s-gpu', 'intel');
  } else if (findEntry('hardware.graphics.enable') &&
             findEntry('hardware.graphics.enable32Bit')) {
    set('#s-gpu', 'amd');
  }

  const locale = cardText('i18n.defaultLocale');
  if (locale) set('#s-lang', Object.keys(LANGUAGES).find(k => LANGUAGES[k].locale === locale));

  const zone = cardText('time.timeZone');
  if (zone && REGIONS[zone]) set('#s-region', zone);

  return found;
}

/* The module route: what it used to do for every file, and still the right
   thing for one nixgen wrote. */
async function intoModule(f, r, incoming, toSetup, opts = {}) {
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

  const notes = [];
  notes.push({ cls: 'ok',
    title: `Imported ${r.matched.length} settings from ${f.name}`,
    title_ja: `${f.name} から${r.matched.length}件の設定を読み込みました`,
    body: (opts.intro ? opts.intro.body + ' ' : '') + (r.used_nix
      ? 'Parsed with nix-instantiate. Your file was not modified.'
      : 'Read directly — nix-instantiate was not on PATH.'),
    body_ja: (opts.intro ? opts.intro.body_ja : '') + (r.used_nix
      ? 'nix-instantiate で解析しました。読んだファイルは書き換えていません。'
      : 'nix-instantiate が PATH に無かったため、自前の読み取りを使いました。') });
  if ((opts.extraImports || []).length) {
    notes.push({ cls: 'ok',
      title: `${opts.extraImports.length} import(s) merged into the imports list`,
      title_ja: `imports の行を${opts.extraImports.length}件、取り込みました`,
      list: opts.extraImports,
      body: 'Keep this configuration.nix in the same directory as the file ' +
            'you read in, so those relative paths still resolve.',
      body_ja: '相対パスが解決できるよう、この configuration.nix は読み込んだ' +
               'ファイルと同じディレクトリに置いてください。' });
  }
  (r.notes || []).forEach(n => notes.push({ cls: 'warn',
    title: 'Adjusted while reading', title_ja: '読み込みの際に調整した点',
    body: n }));
  /* Nix will not parse a file that defines one attribute twice — it is a parse
     error, not a warning — so the file was read without it. Said here rather
     than left as a refusal: the rest of the file is the user's settings, and
     reading it in is what lets nixgen show the clash instead of only Nix
     naming a line number. Reading it also resolves it, since a second card on
     one path replaces the first. */
  if (r.duplicate) {
    notes.push({ cls: 'warn',
      title: `${r.duplicate} was defined twice in that file`,
      title_ja: `そのファイルでは ${r.duplicate} が2回定義されていました`,
      body: 'Nix refuses such a file outright — it is a parse error, so ' +
            'nixos-rebuild stops before it starts. It was read without Nix ' +
            'this time so nothing is lost, and reading it in leaves one ' +
            'definition. Check that card before you build.',
      body_ja: 'Nix はこうしたファイルをそのまま拒否します。構文エラーなので ' +
               'nixos-rebuild は始まる前に止まります。今回は Nix を使わずに' +
               '読んだので失われたものはなく、読み込んだ結果は定義1つに' +
               'なっています。ビルド前にそのカードを確認してください。' });
  }
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
  if (toSetup.length || (opts.extraImports || []).length) {
    syncSetupVisibility();
    await loadStarter();
  }
  if (opts.intro) showFile('configuration.nix');
  const picked = syncPresetPickers();
  const tail = picked.length
    ? ` The Options dropdowns now show what the file had chosen ` +
      `(${picked.join(', ')}) — nothing was re-applied.`
    : '';
  const tailJa = picked.length
    ? `Options のプルダウンは、ファイルが選んでいた内容(${picked.join('、')})を` +
      `表示しています。設定を入れ直してはいません。`
    : '';
  setStatus(say(`Imported ${r.matched.length} settings.${tail}`,
                `${r.matched.length}件の設定を読み込みました。${tailJa}`), 'ok');
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

$('#btn-dl-one').addEventListener('click', async () => {
  if (!await settled()) return;
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

// `name` is the file the text came from, so the parser's error names the file
// you are looking at rather than always saying generated.nix.
const checkText = (text, name) => fetch('/api/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text, name }),
}).then(r => r.json());

$('#btn-check').addEventListener('click', async () => {
  if (!await settled()) return;
  setStatus(say('Checking…', '確認しています…'));
  if (state.file !== ALL) {
    const r = await checkText(currentText(), state.file);
    return setStatus(sayCheck(r), r.ok === true ? 'ok' : r.ok === false ? 'bad' : '');
  }
  /* On the archive tab there is no one file to check, so it checks the three
     that are about to be downloaded and names which of them failed — a report
     that says only "parses cleanly" would not say what did. */
  const names = ['generated.nix', 'configuration.nix', 'flake.nix'];
  const texts = [generatedText, state.starter['configuration.nix'] || '',
                 state.starter['flake.nix'] || ''];
  const rs = await Promise.all(texts.map((t, i) => checkText(t, names[i])));
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
