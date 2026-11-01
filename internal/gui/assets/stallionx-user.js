// One account lifecycle for the commercial client, not a second wallet login.
let current = null, pending = null, generation = 0, busy = false, notice = '', error = '', resendAt = 0, resendTimer, wasReady = false;
const listeners = new Set();
let confirmRepair = false;
const gate = el('section', 'stxu-gate');
gate.id = 'stxUserGate';
gate.setAttribute('aria-label', t('User center'));
document.body.append(gate);
const email = input('', 'you@example.com', 'email'), code = input('', '', 'text'), invite = input('', '', 'text');
for (const field of [email, code, invite]) field.classList.add('words');
code.inputMode = 'numeric'; code.autocomplete = 'one-time-code';
const ready = () => current?.state === 'authenticated' && current.setup === 'ready' && current.providerConnected;
const identity = u => u?.state === 'authenticated' ? [u.service, u.email, u.profile?.id].join('\n') : '';
function button(label, action, primary = false) {
  const b = el('button', 'text action stxu-button' + (primary ? ' primary' : ''), t(label));
  b.type = 'button'; b.disabled = busy; b.onclick = action; return b;
}
function emit() { for (const fn of listeners) fn(current); }
function apply() {
  const accountOnly = current?.state === 'authenticated' && !ready();
  const locked = !ready() && !(accountOnly && mode === 'window' && view === 'stallion-wallet');
  document.documentElement.classList.toggle('stx-account-only', accountOnly);
  document.documentElement.classList.toggle('stx-user-locked', locked);
  gate.hidden = !locked;
  for (const node of document.body.children) {
    if (node === gate || /^(SCRIPT|STYLE|LINK)$/.test(node.tagName)) continue;
    if (locked) {
      if (!node.hasAttribute('data-stxu-inert')) node.setAttribute('data-stxu-inert', node.inert ? 'keep' : 'clear');
      node.inert = true;
    } else if (node.hasAttribute('data-stxu-inert')) {
      node.inert = node.getAttribute('data-stxu-inert') === 'keep'; node.removeAttribute('data-stxu-inert');
    }
  }
  draw(); emit();
  const nowReady = ready();
  if (nowReady && !wasReady) queueMicrotask(() => load().catch(statusErr));
  wasReady = nowReady;
}
async function request(path, body) {
  const version = generation;
  const r = await fetch('/api/stallionx/' + path, {method:body === undefined ? 'GET':'POST',headers:{'Content-Type':'application/json'},body:body === undefined ? undefined:JSON.stringify(body),cache:'no-store'});
  const text = await r.text(); let data;
  try { data = JSON.parse(text); } catch {
    if (r.status === 404) throw new Error(t('Billing API is unavailable. Restart StallionX to load the updated backend.'));
    throw new Error(notJSON(r,text));
  }
  if (!r.ok) {
    const e = new Error(data?.error || r.statusText); e.code = data?.code;
    if (version === generation && (e.code === 'user_session_required' || e.code === 'wallet_session_required')) { current = {...current,state:'expired'}; generation++; apply(); }
    throw e;
  }
  return data;
}
async function refresh() {
  if (pending) return pending;
  const version = generation;
  pending = request('user').then(u => {
    if (version !== generation) return current;
    if (identity(current) !== identity(u)) generation++;
    current = u; error = ''; apply(); return u;
  }).catch(e => {
    if (version === generation) { error = e.message; current = {...current,state:'unavailable'}; apply(); }
    return current;
  }).finally(() => { pending = null; });
  return pending;
}
// Keep one mutation lock, but name its operation so unrelated controls never
// claim to be submitting. Disabled prevents overlap; loading describes work.
async function act(fn, operation = 'account') {
  if (busy) return;
  busy = operation; error = ''; notice = ''; draw();
  try { await fn(); } catch(e) { error = e.message; }
  finally { busy = false; apply(); }
}
async function signOut() {
  await act(async () => {
    generation++; current = await request('signout', {});
    email.value = code.value = invite.value = ''; resendAt = 0; clearInterval(resendTimer);
    notice = t('Signed out of StallionX');
    loadProvidersNow().catch(statusErr);
  });
}
async function sync() {
  await act(async () => { current = await request('sync', {}); generation++; if (ready()) await loadProvidersNow(); });
}
async function openCenter() {
  if (mode !== 'window') return api('window/main?view=stallion-wallet', {});
  await show('stallion-wallet'); apply();
}
function repairControls() {
  const box = el('div', 'stxu-repair');
  box.append(el('p','stxu-copy',t('Restore automatic setup by preserving your custom provider separately and turning it off. Its saved credentials and models will not be deleted.')));
  if (confirmRepair) {
    box.append(button('Confirm restore',()=>act(async()=>{ current=await request('repair',{confirm:true}); generation++; confirmRepair=false; }),true),
      button('Cancel',()=>{confirmRepair=false;apply();}));
  } else box.append(button('Restore automatic setup',()=>{confirmRepair=true;apply();},true));
  if (error) { const n=el('p','stxu-error',error); n.setAttribute('role','alert'); box.append(n); }
  return box;
}
async function signIn() {
  if (!email.validity.valid || !email.value.trim()) { error=t('Enter an email address'); draw(); return; }
  if (!code.value.trim()) { error=t('Enter the code from the email'); draw(); return; }
  await act(async () => {
    generation++;
    current = await request('signin', {email:email.value.trim(),code:code.value.trim(),invite:invite.value.trim(),locale});
    code.value = invite.value = ''; notice='';
    if (ready()) { adding=false; await loadProvidersNow(); await openCenter(); }
  }, 'signin');
}
async function sendCode() {
  if (Date.now()<resendAt) return;
  if (!email.validity.valid || !email.value.trim()) { error=t('Enter an email address'); draw(); return; }
  await act(async () => {
    const sent = await request('code',{email:email.value.trim(),locale});
    resendAt = Date.now()+60000;
    if (sent?.testCode) code.value=sent.testCode;
    notice=t('Code sent to {email}. Check your spam folder if it isn\'t there.',{email:email.value.trim()});
    clearInterval(resendTimer);
    resendTimer=setInterval(() => {
      const b=gate.querySelector('#stxSendCode');
      if (b) updateSend(b);
      if (Date.now()>=resendAt) clearInterval(resendTimer);
    },1000);
  }, 'code');
}
function updateSend(b) {
  const seconds=Math.max(0,Math.ceil((resendAt-Date.now())/1000));
  b.textContent=busy === 'code' ? t('Sending…') : seconds ? t('Resend ({n}s)',{n:seconds}) : t('Send code'); b.disabled=!!busy||seconds>0;
  b.setAttribute('aria-busy', String(busy === 'code'));
}
function field(label, node) {
  const wrapper=el('label','stxu-field');wrapper.append(el('span','',t(label)),node);
  node.setAttribute('aria-label',t(label)); node.disabled=busy; return wrapper;
}
function draw() {
  if (gate.hidden) return;
  const box=el('div','stxu-login'), mark=el('div','stxu-brand'); mark.append(icon('stallionx'),el('strong','','StallionX'));
  box.append(mark);
  if (!current) {
    box.append(el('h1','',t('Restoring your account')),el('p','stxu-copy',t('Connecting to Stallion…')));
  } else if (current.state === 'unavailable') {
    box.append(el('h1','',t('Unable to connect to Stallion')),el('p','stxu-copy',t('Your account has not been signed out. Check your connection and try again.')),
      button('Retry connection',() => refresh(),true),button('Sign out',signOut));
  } else if (current.state === 'authenticated') {
    box.append(el('h1','',t(busy ? 'Setting up your workspace' : 'Workspace setup needs attention')),
      el('p','stxu-copy',t('Your account is signed in. Stallion will configure your access key and available models automatically.')),
      el('p','stxu-identity',current.email || current.username || ''),
      el('p','stxu-copy',current.setupMessage || ''),button('Retry setup',sync,true),
      button('Open user center',()=>openCenter().catch(e=>{error=e.message;draw();})),button('Sign out',signOut));
    if (current.setupConflict) box.append(repairControls());
  } else {
    // The wordmark already names the product; keep the heading focused on
    // the action instead of repeating StallionX in two adjacent lines.
    box.classList.add('stxu-signin');
    box.append(el('h1','',t('Sign in')));
    if (current.state === 'expired') box.append(el('p','stxu-copy',t('Your session has expired. Sign in to continue.')));
    if (!email.value && current.email) email.value=current.email;
    const form=el('form','list stxu-login-form');
    email.autocomplete='email'; code.placeholder=t('6-digit code'); invite.placeholder=t('Invite code (optional)');
    const codeRow=el('div','stxu-code-row'), send=button('Send code',sendCode);
    send.id='stxSendCode';send.classList.add('stxu-send');updateSend(send);
    codeRow.append(field('6-digit code',code),send);
    const go=button(busy === 'signin' ? 'Signing in…':'Sign in',() => form.requestSubmit(),true); go.type='submit';go.onclick=null;
    go.setAttribute('aria-busy', String(busy === 'signin'));
    form.onsubmit=e=>{e.preventDefault();signIn();};
    form.append(field('Email',email),codeRow,field('Invite code (optional)',invite),go);
    box.append(form);
    const terms=el('p','stxu-terms');
    const pieces=t('By signing in you agree to the {terms} and {privacy}.').split(/(\{terms\}|\{privacy\})/);
    for(const p of pieces) {
      if(p==='{terms}'||p==='{privacy}') { const isTerms=p==='{terms}'; const b=button(isTerms?'Terms of Service':'Privacy Policy',()=>api('open',{url:isTerms?current.terms:current.privacy}).catch(statusErr)); b.className='text stxu-link';terms.append(b); }
      else terms.append(p);
    }
    box.append(terms);
  }
  if (error || current?.message && current.state==='unavailable') { const n=el('p','stxu-error',error||current.message);n.setAttribute('role','alert');box.append(n); }
  if (notice) { const n=el('p','stxu-notice',notice);n.setAttribute('role','status');box.append(n); }
  gate.replaceChildren(box);
}
window.stxUser={get current(){return current;},refresh,request,signOut,sync,apply,repairControls,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
window.addEventListener('focus',()=>{if(!busy)refresh();});
// Poll only account state; the backend shares its bounded validation cache.
setInterval(()=>{if(!document.hidden&&!busy)refresh();},60000);
apply();
await refresh();
