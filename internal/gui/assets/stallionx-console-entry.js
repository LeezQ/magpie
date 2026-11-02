// Separate-origin Web console. The native page owns login and navigation; only
// a scoped capability enters the frame, never service or provider credentials.
let frame, origin, capability, opening, identity = '', serial = 0;
let route = new URLSearchParams(location.search).get('account') || '/personal/dashboard';
let items = [], shown = false;
let navLayoutFrame = 0, selectedNavigation;
let bootTimer;
const glyphs = {
  personalOverview:'M3 10 10 3l7 7M5 8v9h10V8M8 17v-5h4v5', overview:'M3 10 10 3l7 7M5 8v9h10V8M8 17v-5h4v5',
  tokens:'M12 3a5 5 0 1 1-4 8l-5 5v2h3v-3h3l2-2', logs:'M5 2h7l4 4v12H5ZM8 9h5M8 12h5M8 15h3',
  playground:'m3 5 5 5-5 5m7 0h7', models:'m10 2 8 4-8 4-8-4Zm-8 8 8 4 8-4M2 14l8 4 8-4',
  topup:'M3 5h14v12H3ZM3 8h14M10 11v4m-2-2h4', orders:'M5 2h10v16l-2-1-3 1-3-1-2 1ZM8 6h4M8 10h4',
  balanceLog:'M3 5h14v12H3ZM12 9h5v4h-5Z', subscription:'M3 5h14v12H3ZM3 8h14', mySubscription:'M3 16V8m7 8V3m7 13v-6',
  user:'M13 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM4 18v-2a6 6 0 0 1 12 0v2', users:'M12 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 18v-2a6 6 0 0 1 12 0v2m0-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 2 5',
};
const destination = p => typeof p === 'string' && p.length < 2048 && /^\/(?:personal\/(?:dashboard|token|log|balance-log)|profile(?:\/teams)?|team(?:\/[a-zA-Z0-9_-]+(?:\/(?:overview|tokens|playground|models|logs|usage|members|wallet|activity|settings))?)?|topup(?:\/result)?|orders|playground|models|notifications|subscription|my-subscription|403)(?:[?#].*)?$/.test(p) && !/[\\\r\n]/.test(p);
if (!destination(route)) route = '/personal/dashboard';
const userIdentity = u => u?.state === 'authenticated' ? [u.service, u.profile?.id || u.email].join('\n') : '';
function send(type, values = {}) {
  if (frame && origin) frame.contentWindow.postMessage({...values, type}, origin);
}
// copyForFrame writes text the console frame asked to copy (bridge.js
// bridgeWriteText) to the system clipboard, and says whether it is there.
// The frame's own navigator.clipboard is refused in the app's window, so this
// takes the same ways app.js copy() does, in its order: magpie's native
// POST /api/copy (which reads the clipboard back where it can), then this
// page's clipboard API (a browser tab on `magpie web`), then the copy command.
// The frame shows its own toast, so nothing is shown here.
async function copyForFrame(text) {
  const res = await fetch('/api/copy', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text})}).catch(() => null);
  if (res?.ok) return true;
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  return typeof copyByCommand === 'function' && copyByCommand(text);
}
function appearance() {
  const root = document.documentElement, style = getComputedStyle(root), body = getComputedStyle(document.body);
  const theme = root.dataset.theme || 'system', tokens = {};
  for (const key of ['bg','card','card-2','pill','pill-hover','ctl-fg','line','line-2','fg','fg-2','muted','accent','accent-soft','accent-fg','green','red','amber','pop-bg','c1','c2','c3','c4','c5']) tokens[key] = style.getPropertyValue('--' + key).trim();
  tokens.font = body.fontFamily;
  tokens.code = style.getPropertyValue('--code-font').trim() || style.getPropertyValue('--code').trim();
  tokens.weight = body.fontWeight; tokens.style = body.fontStyle; tokens.stretch = body.fontStretch;
  return {theme, resolvedTheme: theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme, tokens, reducedMotion: root.dataset.motion === 'reduce', locale: /^zh/.test(locale) ? 'zh-CN' : 'en'};
}
function fitNavigation() {
  if (navLayoutFrame) return;
  navLayoutFrame = requestAnimationFrame(() => {
    navLayoutFrame = 0;
    const nav = document.querySelector('#nav');
    // Account routes arrive after the shell's first layout and all share one
    // view id. Refit after their real selection, not the shell's placeholder.
    fitTop();
    const selected = nav.querySelector('button.on:not([hidden])');
    if (sideNav()) { navTopGo(selected, false); return; }
    slide(nav, 'nav');
    if (!selected || nav.scrollWidth <= nav.clientWidth) return;
    const r = selected.getBoundingClientRect(), box = nav.getBoundingClientRect();
    if (r.left < box.left + 4) nav.scrollLeft -= box.left + 4 - r.left;
    else if (r.right > box.right - 4) nav.scrollLeft += r.right - box.right + 4;
  });
}
function markNavigation() {
  let changed = false;
  for (const button of document.querySelectorAll('#nav [data-stx-route]')) {
    const selected = view === 'stallion-wallet' && button.dataset.stxRoute === route.split(/[?#]/)[0];
    changed ||= button.classList.contains('on') !== selected;
    button.classList.toggle('on', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  const old = document.querySelector('#stxWalletEntry');
  if (items.length) { changed ||= old.classList.contains('on'); old.classList.remove('on'); old.removeAttribute('aria-current'); }
  if (view === 'stallion-wallet') {
    const selected = items.find(item => item.path === route.split(/[?#]/)[0]);
    if (selected) {
      document.querySelector('#pageTitle').textContent = selected.title;
      const crumb = document.querySelector('#crumb'), title = selected.group + ' / ' + selected.title;
      if (crumb && crumb.textContent !== title) crumb.textContent = title;
    }
  }
  const selected = document.querySelector('#nav button.on:not([hidden])');
  if (changed || selected !== selectedNavigation) { selectedNavigation = selected; fitNavigation(); }
}
function navigate(path) {
  if (!destination(path)) return;
  route = path;
  const params = new URLSearchParams(location.search);
  params.set('account', path);
  history.replaceState(null, '', '?' + params);
  show('stallion-wallet').then(() => { send('stx-console-navigate', {path}); markNavigation(); stxUser.apply(); }).catch(statusErr);
}
function drawNavigation(next) {
  if (JSON.stringify(items) === JSON.stringify(next)) { markNavigation(); return; }
  items = next;
  document.querySelectorAll('#nav [data-stx-route], #nav .stxc-nav-group').forEach(n => n.remove());
  const nav = document.querySelector('#nav');
  nav.classList.toggle('stxc-navigation', !!items.length);
  window.stxConsoleNavigationState(items.length ? 'ready' : 'loading');
  document.querySelector('#stxWalletEntry').hidden = !!items.length;
  let group = '';
  for (const item of items) {
    if (item.group !== group) {
      group = item.group;
      const label = document.createElement('div'); label.className = 'stxc-nav-group'; label.textContent = group;
      nav.append(label);
    }
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.view = 'stallion-wallet'; button.dataset.stxRoute = item.path;
    const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); glyph.classList.add('nav-ic'); glyph.setAttribute('viewBox','0 0 20 20'); glyph.setAttribute('width','16'); glyph.setAttribute('height','16'); glyph.setAttribute('aria-hidden','true');
    const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'path'); stroke.setAttribute('d',glyphs[item.icon] || glyphs.logs); stroke.setAttribute('fill','none'); stroke.setAttribute('stroke','currentColor'); stroke.setAttribute('stroke-width','1.4'); stroke.setAttribute('stroke-linecap','round'); stroke.setAttribute('stroke-linejoin','round'); glyph.append(stroke);
    const label = document.createElement('span'); label.textContent = item.title;
    button.append(glyph, label); button.onclick = () => navigate(item.path); nav.append(button);
  }
  markNavigation();
  fitNavigation();
}
function clearConsole() {
  clearTimeout(bootTimer);
  serial++; opening = null; capability = origin = '';
  frame?.remove(); frame = null;
  drawNavigation([]);
  window.stxConsoleNavigationState('loading');
}
function message(text, retry) {
  const box = document.querySelector('#stxWallet');
  const p = document.createElement('p'); p.className = 'stxu-copy'; p.textContent = text;
  box.replaceChildren(p);
  if (retry) { const b = document.createElement('button'); b.className = 'text action'; b.textContent = t('Retry connection'); b.onclick = () => window.stxOpenConsole(); box.append(b); }
}
function recovery() {
  const box = document.querySelector('#stxWallet');
  if (!box || !frame) return;
  box.querySelector('.stxc-recovery')?.remove();
  const user = stxUser.current;
  if (user?.state !== 'authenticated' || user.setup === 'ready' && user.providerConnected) return;
  const banner = document.createElement('section'); banner.className = 'stxc-recovery';
  const text = document.createElement('p'); text.textContent = user.setupMessage || t('Workspace setup needs attention');
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text action'; retry.textContent = t('Retry setup'); retry.onclick = () => stxUser.sync();
  banner.append(text,retry);
  if (user.setupConflict) banner.append(stxUser.repairControls());
  box.prepend(banner);
}
async function open() {
  if (mode !== 'window') return;
  shown = true;
  if (stxUser.current?.state !== 'authenticated') return;
  if (frame) { markNavigation(); return; }
  if (opening) return opening;
  const version = serial;
  window.stxConsoleNavigationState('loading');
  message(t('Connecting to Stallion…'));
  const failed = error => {
    if (version !== serial) return;
    clearConsole();
    window.stxConsoleNavigationState('error', error);
    message(error, true);
    fitNavigation();
  };
  // A frame whose assets cannot load must not leave navigation waiting forever.
  bootTimer = setTimeout(() => failed(t('Retry connection')), 20000);
  opening = (async () => {
    const session = await stxUser.request('console-session', {});
    if (version !== serial || stxUser.current?.state !== 'authenticated') return;
    const url = new URL(session.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || !session.capability) throw new Error('Invalid account console destination');
    origin = url.origin; capability = session.capability;
    frame = document.createElement('iframe'); frame.className = 'stxc-frame'; frame.title = t('User center');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads');
    frame.setAttribute('allow', "clipboard-write 'src'");
    frame.referrerPolicy = 'no-referrer'; frame.src = session.url + '#' + route;
    const box = document.querySelector('#stxWallet'); box.classList.add('stxc-host'); box.replaceChildren(frame);
    recovery();
  })().catch(e => failed(e.message)).finally(() => { if (version === serial) opening = null; });
  return opening;
}
window.addEventListener('message', event => {
  if (!frame || event.source !== frame.contentWindow || event.origin !== origin) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  switch (data.type) {
    case 'stx-console-ready':
      send('stx-console-init', {capability, service: stxUser.current.service, user: stxUser.current, ...appearance()}); break;
    case 'stx-console-navigation':
      if (!destination(data.route) || !Array.isArray(data.items)) return;
      route = data.route;
      drawNavigation(data.items.slice(0, 24).filter(item => destination(item.path) && typeof item.title === 'string' && typeof item.group === 'string').map(item => ({path:item.path, title:item.title.slice(0,100), group:item.group.slice(0,100), icon:item.icon})));
      if (items.length) clearTimeout(bootTimer);
      if (view === 'stallion-wallet') {
        const p = new URLSearchParams(location.search); p.set('account', route); history.replaceState(null, '', '?' + p);
      }
      break;
    case 'stx-console-copy': {
      // Only the frame and its origin reach here (checked above). The text is
      // a bounded non-empty string, as bridge.js sends; anything else is
      // answered as a failed copy, so the frame's page shows "copy failed"
      // instead of waiting for its timeout. The id only pairs the answer.
      const id = data.id, text = data.text;
      if (!Number.isSafeInteger(id)) return;
      if (typeof text !== 'string' || !text || text.length > 65536) { send('stx-console-copied', {id, ok:false}); break; }
      copyForFrame(text).then(ok => send('stx-console-copied', {id, ok}), error => {
        console.error('[StallionX console] copy failed:', error);
        send('stx-console-copied', {id, ok:false});
      });
      break;
    }
    case 'stx-console-auth-expired':
      clearConsole(); stxUser.refresh(); break;
    case 'stx-console-signout':
      stxUser.signOut(); break;
    case 'stx-console-open-external': {
      let url;
      try { url = new URL(data.url); } catch { return; }
      const service = new URL(stxUser.current.service);
      const own = url.origin === service.origin && /^\/(?:profile(?:\/teams)?|api-reference(?:\/[a-zA-Z0-9_-]+)?|terms|privacy|refund-policy|status)\/?$/.test(url.pathname);
      const checkout = url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.port;
      if ((!own && !checkout) || url.username || url.password) return;
      api('open', {url:url.href}).catch(statusErr); break;
    }
  }
});
stxUser.subscribe(user => {
  const next = userIdentity(user);
  // An outage does not log the user out, but a replacement login cannot retain
  // an old frame or its queries. The backend independently pins the capability.
  if (user?.state !== 'unavailable' && next !== identity) {
    identity = next; clearConsole();
    if (next && mode === 'window') open();
  }
  recovery();
});
identity = userIdentity(stxUser.current);
const syncAppearance = () => { if (frame) send('stx-console-appearance', appearance()); };
new MutationObserver(syncAppearance).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme','data-colorblind','data-motion','lang','style','class']});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncAppearance);
new MutationObserver(markNavigation).observe(document.querySelector('#crumb'), {childList:true});
document.querySelector('#nav').addEventListener('click', () => queueMicrotask(markNavigation));
new ResizeObserver(fitNavigation).observe(document.querySelector('#nav'));
addEventListener('resize', fitNavigation);
document.querySelector('#nav').addEventListener('wheel', event => {
  const nav = event.currentTarget;
  if (sideNav() || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || nav.scrollWidth <= nav.clientWidth) return;
  const before = nav.scrollLeft;
  nav.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? nav.clientWidth : 1);
  if (nav.scrollLeft !== before) event.preventDefault();
}, {passive:false});
window.stxOpenConsole = open;
window.stxLeaveConsole = () => { shown = false; queueMicrotask(markNavigation); };
window.stxPrepareConsole = async () => { if (mode === 'window') { await open(); shown = view === 'stallion-wallet'; } };
