// Presentation policy for the dedicated client, loaded before the first paint.
// This does not disable plugins, change saved providers or enforce API access:
// the gateway and CLI keep their existing behavior. Keep visibility and route
// decisions together so search, old links and dynamic UI cannot restore a page.
const stxUI = (() => {
  const enabled = !!window.bootPrefs?.stallionxEnabled;
  // Keep the built-in pages the user chose. Community plugin management
  // remains hidden; no runtime plugin switches are changed.
  const views = new Set(["agents", "providers", "masking", "settings", "stallion-wallet"]);
  // The built-in pages that are their own feature and that this client
  // leaves out of its menu. Whatever app.js marks data-feature="<page>" goes
  // with its page, as it does when that feature is switched off (app.js
  // featureSel): a link or button that opens it (the sidebar's gateway
  // status, "Open Routing", "Make a routing group", "Open Usage") and a
  // setting only it uses. Each page and its backend keep running; a saved
  // or old link to one opens Providers (show in app.js).
  const pages = ["sessions", "library", "routing", "gateway", "usage"];
  const settings = new Set(["general", "usage", "network", "models", "privacy", "about"]);
  const selectors = [
    '#nav [data-view]' + [...views].map((id) => `:not([data-view="${id}"])`).join(''),
    ...pages.map((id) => `[data-feature~="${id}"]`),
    '.plugin-slot', '.ag-install-plugins',
    '#view-agents .profiles', '#profBtn',
    '#agents .row.agent:has(.ag-cant)',
    '#view-providers > :not(#stxAccount):not(#fileError):not(#providers)',
    '#setTabs [data-set]' + [...settings].map((id) => `:not([data-set="${id}"])`).join(''),
    '.set-page' + [...settings].map((id) => `:not(#setPage-${id})`).join(''),
    '#agentsLead',
    '#setPage-general .row:has(#plainNamesSegs)',
  ];
  const selector = selectors.join(',');
  if (enabled) {
    document.documentElement.classList.add('stallionx-client', 'stx-user-locked');
    const style = document.createElement('style');
    style.textContent = selector + '{display:none!important}';
    document.head.append(style);
  }
  return {
    enabled,
    view: (id) => !enabled || views.has(id),
    setting: (id) => !enabled || settings.has(id),
    hides: (node) => enabled && !!node?.closest(selector),
    // The providers the account owns: the personal wallet's and each team
    // wallet's turned on here (internal/stallionx/payers.go). Only these
    // show on the Providers page.
    provider: (id) => id === 'stallionx' || /^stallionx-team-[a-z0-9]+$/.test(id || ''),
  };
})();
