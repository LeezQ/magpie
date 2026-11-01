// Register with the existing page lifecycle before app.js wires navigation.
// Account navigation has one loading state, not a temporary legacy menu.
if (stxUI.enabled) magpie.plugin("stallion-wallet", (ctx) => {
  const entry = document.createElement("button");
  entry.type = "button";
  entry.id = "stxWalletEntry";
  entry.dataset.view = "stallion-wallet";
  entry.innerHTML = '<svg class="nav-ic" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="6.5" r="3"/><path d="M4 17v-1a6 6 0 0 1 12 0v1"/></g></svg><span data-t>StallionX account</span>';
  document.querySelector("#nav").append(entry);
  const pending = document.createElement('div');
  pending.id = 'stxcNavPending'; pending.setAttribute('role', 'status');
  pending.innerHTML = '<button type="button" disabled><span data-t>Loading…</span></button><i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i>';
  document.querySelector('#nav').append(pending);
  const pendingButton = pending.querySelector('button');
  window.stxConsoleNavigationState = (state, error = '') => {
    document.documentElement.dataset.stxcNavigation = state;
    pending.hidden = state === 'ready';
    pendingButton.disabled = state !== 'error';
    pendingButton.textContent = t(state === 'error' ? 'Retry connection' : 'Loading…');
    pendingButton.title = error;
    pending.setAttribute('aria-busy', String(state === 'loading'));
  };
  document.documentElement.dataset.stxcNavigation = 'loading';
  pendingButton.onclick = () => show('stallion-wallet').then(open).catch(statusErr);
  const auth = import("/stallionx-wallet-i18n.js").then(() => import("/stallionx-user.js"));
  auth.then(() => { const label = entry.querySelector("span"); label.dataset.en = "User center"; label.textContent = t("User center"); }).catch((e) => {
    console.error(e);
    const gate = document.querySelector("#stxUserGate") || document.createElement("section");
    gate.id = "stxUserGate"; gate.className = "stxu-gate"; gate.hidden = false;
    const box = document.createElement("div"); box.className = "stxu-login";
    const title = document.createElement("h1"); title.textContent = "StallionX";
    const why = document.createElement("p"); why.className = "stxu-error"; why.setAttribute("role", "alert"); why.textContent = e.message;
    const retry = document.createElement("button"); retry.className = "text action stxu-button primary"; retry.textContent = t("Refresh"); retry.onclick = () => location.reload();
    box.append(title, why, retry); gate.replaceChildren(box); document.body.append(gate);
  });
  let ready;
  ready = auth.then(() => import('/stallionx-console-entry.js')).then(() => window.stxPrepareConsole?.()).catch(e => { ready = null; window.stxConsoleNavigationState('error', e.message); console.error(e); });
  const open = async () => {
    if (mode !== "window") return api("window/main?view=stallion-wallet", {});
    try {
      ready ||= auth.then(() => import("/stallionx-console-entry.js"));
      await ready;
      if (view === "stallion-wallet") return window.stxOpenConsole();
    } catch (e) { ready = null; window.stxConsoleNavigationState('error', e.message); throw e; }
  };
  ctx.slots.add("page", {
    key: "stallion-wallet", title: "User center",
    html: '<div id="stxWallet" class="stx-wallet"></div>',
    open, reload: open, relang: open,
    leave() { window.stxLeaveConsole?.(); },
  });
});
