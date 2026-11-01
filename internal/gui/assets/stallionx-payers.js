// Payers: the wallets this computer's requests can be paid from, and the
// one-time question of which is the default (internal/stallionx/payers.go).
//
// The personal wallet is set up by the sign-in. A team's wallet is set up
// only when the user turns it on here, which makes a team key the team's
// owner and admins can see, disable or delete. Each wallet is its own
// provider ("StallionX · <team>"), so the model an agent uses says who pays,
// and nothing moves a request from one wallet to another on its own.
//
// The list is drawn wherever it is mounted (the Providers page's account
// card, the setup gate) and every mount redraws from one copy of the list.

// What a payer's state means, in words for people (payers.go's state*).
const STATES = {
  ready: 'Ready to use',
  not_enabled: 'Not used on this computer',
  key_disabled: "A team admin disabled this computer's key",
  key_missing: "This computer's key was deleted from the team",
  not_team_member: 'You are no longer in this team',
  team_disabled: 'This team is disabled',
  team_disbanded: 'This team was disbanded',
  conflict: "Its provider was edited on this computer",
  setup_failed: 'Setup needs attention',
};
// The user's role in a team, as the service numbers it.
const ROLES = { 1: 'Owner of this team', 2: 'Admin of this team', 3: 'Member of this team' };
// A team in one of these states can't be set up again from here.
const GONE = new Set(['not_team_member', 'team_disabled', 'team_disbanded']);

let list = null, loadedAt = 0, loading = null, busy = '', error = '', asking = false;
const mounts = new Set();

const request = (path, body) => window.stxUser.request(path, body);

// load reads the payers again, and every mounted list redraws.
function load() {
  loading ||= request('payers')
    .then((l) => { list = l; loadedAt = Date.now(); error = ''; return l; })
    // a failed read waits like a good one before the next mount asks again
    .catch((e) => { error = e.message; loadedAt = Date.now(); return list; })
    .finally(() => { loading = null; redraw(); });
  return loading;
}

function redraw() {
  for (const box of [...mounts]) {
    if (!box.isConnected) { mounts.delete(box); continue; }
    draw(box);
  }
}

// afterChange brings the rest of the app up to a payer change: the account
// state (a team can be what opens the workspace) and the providers list.
function afterChange() {
  window.stxUser.refresh().catch(statusErr);
  if (typeof loadProvidersNow === 'function') loadProvidersNow().catch(statusErr);
}

// act runs one payer change at a time; its answer is the new list.
async function act(id, path, body) {
  if (busy) return;
  busy = id; error = ''; redraw();
  try { list = await request(path, body); loadedAt = Date.now(); afterChange(); }
  catch (e) { error = e.message; }
  finally { busy = ''; redraw(); }
}

// ask is confirmAction (app.js), its dialog marked to show over the setup
// gate, which hides the rest of the page (stallionx-user.css). confirmAction
// appends the dialog before it returns.
function ask(title, message, action) {
  const answer = confirmAction(title, message, action);
  [...document.querySelectorAll('body > dialog.action-confirm')].pop()?.classList.add('stxu-over');
  return answer;
}

const KEY_NOTE = "This creates a key for this computer in the team, on the team's default channel group. The team's owner and admins can see it, disable it or delete it. The team pays only for agents set to its models.";

// enable turns team p on here, once the user has read what that makes.
async function enable(p) {
  if (!(await ask(t('Use {team} on this computer?', { team: p.name }), t(KEY_NOTE), t('Use on this computer')))) return;
  act(p.id, 'payers/enable', { id: p.id });
}

async function remove(p) {
  if (!(await ask(t('Remove {team} from this computer?', { team: p.name }), t('Agents set to its models stop working until you pick another model. The key stays in the team, and using the team here again finds it.'), t('Remove')))) return;
  act(p.id, 'payers/remove', { id: p.id });
}

async function makeDefault(p) {
  // a team not set up here yet is set up by choosing it: the same note
  if (p.kind === 'team' && p.state === 'not_enabled' && !(await ask(t('Use {team} on this computer?', { team: p.name }), t(KEY_NOTE), t('Use on this computer')))) return;
  act(p.id, 'payers/default', { id: p.id });
}

// walletText is what is left to spend: the team's balance for its owner and
// admins, the member's own quota for a member.
function walletText(p) {
  const w = p.wallet;
  if (!w) return '';
  if (w.balance != null) return t('Team balance {amount}', { amount: '$' + w.balance });
  if ('remaining_quota' in w) return w.remaining_quota == null ? t('No quota limit') : t('Your quota left {amount}', { amount: '$' + w.remaining_quota });
  return '';
}

function row(p) {
  const r = el('div', 'stxp-row' + (p.default ? ' default' : ''));
  r.dataset.payer = p.id;
  const who = el('div', 'stxp-who');
  const name = el('div', 'stxp-name', p.kind === 'personal' ? t('Personal workspace') : p.name);
  if (p.default) name.append(el('span', 'badge', t('Default')));
  const sub = [p.kind === 'team' ? t(ROLES[p.role] || 'Team wallet') : '', t(STATES[p.state] || STATES.setup_failed), walletText(p)].filter(Boolean).join(' · ');
  who.append(name, el('div', 'stxp-sub', sub));
  // the service's own words for why, when it gave some
  if (p.message && p.state !== 'ready') who.append(el('div', 'stxp-why', p.message));
  const acts = el('div', 'stxp-actions');
  const button = (label, fn, primary) => {
    const b = el('button', 'text' + (primary ? ' primary' : ''), t(label));
    b.type = 'button'; b.disabled = !!busy; b.onclick = fn;
    b.setAttribute('aria-busy', String(busy === p.id));
    return b;
  };
  if (p.kind === 'team' && !GONE.has(p.state)) {
    if (p.state === 'not_enabled') acts.append(button('Use on this computer', () => enable(p), true));
    else if (p.state === 'key_missing' || p.state === 'setup_failed') acts.append(button('Set up again', () => enable(p)));
  }
  if (!p.default && (p.kind === 'personal' || p.state === 'ready' || p.state === 'not_enabled')) acts.append(button('Make default', () => makeDefault(p)));
  if (p.kind === 'team' && p.enabled) acts.append(button('Remove from this computer', () => remove(p)));
  r.append(who, acts);
  return r;
}

function draw(box) {
  // one wallet only (no team): nothing to choose, nothing shown
  if (!error && (!list || list.payers.length < 2)) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  const wrap = el('div', 'stxp');
  wrap.append(el('div', 'stxp-title', t('Who pays')),
    el('p', 'stxp-note', t("Each wallet is its own provider. An agent is paid for by the wallet whose models it uses; requests never move to another wallet on their own.")));
  for (const p of list?.payers || []) wrap.append(row(p));
  if (error) { const n = el('p', 'stxu-error', error); n.setAttribute('role', 'alert'); wrap.append(n); }
  box.replaceChildren(wrap);
}

// mount draws the payers into box from now on, reading them again when the
// copy is older than half a minute.
function mount(box) {
  mounts.add(box);
  draw(box);
  if (!loading && Date.now() - loadedAt > 30000) load();
  return box;
}

// ask puts the one-time question: the account is in a team and the user
// hasn't said which wallet is the default. Escape keeps the personal wallet,
// which is the default anyway, and records the answer, so it isn't asked
// again.
async function askDefault() {
  if (asking) return;
  asking = true;
  const l = await load();
  if (!l?.ask || l.payers.length < 2) { asking = false; return; }
  const d = el('dialog', 'stxp-ask');
  d.setAttribute('aria-labelledby', 'stxpAskTitle');
  const title = el('h2', '', t('Which wallet should this computer use by default?'));
  title.id = 'stxpAskTitle';
  const why = el('p', 'stxu-error');
  why.hidden = true;
  why.setAttribute('role', 'alert');
  d.append(title, el('p', 'stxp-note', t('The default wallet is listed first. You can change it, and pick another wallet for any agent, on the Providers page.')));
  const choose = async (id) => {
    for (const b of d.querySelectorAll('button')) b.disabled = true;
    try { list = await request('payers/default', { id }); loadedAt = Date.now(); }
    catch (e) {
      why.textContent = e.message; why.hidden = false;
      for (const b of d.querySelectorAll('button')) b.disabled = false;
      return;
    }
    d.close(); redraw(); afterChange();
  };
  for (const p of l.payers) {
    if (p.kind === 'team' && p.state !== 'ready' && p.state !== 'not_enabled') continue;
    const b = el('button', 'text stxp-choice');
    b.type = 'button';
    b.dataset.payer = p.id;
    b.append(el('span', 'stxp-name', p.kind === 'personal' ? t('Personal workspace') : p.name));
    if (p.kind === 'team') b.append(el('span', 'stxp-sub', p.enabled ? t(ROLES[p.role] || 'Team wallet') : t("Creates a key for this computer in the team; its admins can see it")));
    b.onclick = () => choose(p.id);
    d.append(b);
  }
  d.append(why);
  d.addEventListener('cancel', (e) => { e.preventDefault(); choose('personal'); });
  d.addEventListener('close', () => { asking = false; d.remove(); });
  document.body.append(d);
  d.showModal();
}

window.stxPayers = { mount, load, ask: askDefault };
