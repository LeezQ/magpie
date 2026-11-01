// Shared, offline-only StallionX fixtures. Every request is fulfilled or aborted;
// no browser request can reach a real account, mail service, payment or key.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const { reach } = require("./reader.cjs");

const assets = path.resolve(__dirname, "../assets");
const origin = "http://magpie.test";
const email = "reader@example.com";
const languages = ["en", "zh", "zh-TW", "ja", "de"];
const engines = process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"];
const wrongCode = "The verification code is incorrect. Please try again.";
const tr = (page, key, vars) => page.evaluate(([key, vars]) => t(key, vars), [key, vars]);

function fixture(lang, initial = "signed_out", theme = "light", options = {}) {
  const f = {
    state: initial, setup: "ready", setupMessage: "", email, balance: "12.123456", paymentEnabled: true,
    userError: "", codeError: "", redeemError: "", walletError: "", walletMissing: false,
    emptyLogs: false, logs: null, keys: null, orders: [], posts: [], userReads: [], providerReads: [], reads: [], unexpected: [],
    holdSignIn: null, holdRedeem: null, holdSetup: null, setupFail: false,
    guardWorkspace: false, blockedReads: [], accountID: "user_fixture", windows: [], assetFailure: "", setupConflict: false,
    // payers (stallionx-payers.js): the account's teams, as payers.go lists
    // them, whether the default question is still open, and the default
    teams: [], payerAsk: false, defaultPayer: "personal", providerOff: {},
  };
  const settings = { lang, theme, stallionxEnabled: true, ...(options.native ? { textSize: Math.round((options.zoom || 1) * 100) } : {}) };
  const provider = {
    id: "stallionx", name: "StallionX", icon: "stallionx", key: { set: true, masked: "sk-fixture…only" },
    chat: "https://service.test/v1", ready: true,
    keyList: [{ id: "primary", on: true, active: true, masked: "sk-fixture…only" }],
    models: [{ id: "fixture-model", name: "Fixture model", on: true }], agents: [], headers: {}, fallback: [],
  };
  const other = { id: "other-service", name: "Other service", models: [], agents: [], key: { set: true } };
  // payers.go's list: the personal wallet, then each team
  f.payerList = () => ({ ask: f.payerAsk && f.teams.length > 0, payers: [
    { id: "personal", kind: "personal", providerId: "stallionx", enabled: true, state: f.setup === "ready" ? "ready" : "setup_failed", default: f.defaultPayer === "personal" },
    ...f.teams.map(t => ({ id: t.id, kind: "team", name: t.name, role: t.role, providerId: "stallionx-" + t.id.replace("_", "-"), enabled: !!t.enabled, state: t.enabled ? "ready" : "not_enabled", default: f.defaultPayer === t.id, wallet: t.wallet })),
  ] });
  const teamProviders = () => f.teams.filter(t => t.enabled).map(t => ({ ...provider, id: "stallionx-" + t.id.replace("_", "-"), name: "StallionX · " + t.name }));
  const providerList = () => ({ providers: (f.state === "signed_out" ? [other] : [provider, ...teamProviders(), other]).map(p => ({ ...p, off: !!f.providerOff[p.id] })), presets: [{ id: "other", name: "Other service" }], excluded: [],
    gateway: { running: true, window: true, mine: true, url: "http://127.0.0.1:3999", calls: [], groups: [] } });
  const common = () => ({ service: "https://service.test", terms: "https://service.test/terms", privacy: "https://service.test/privacy", providerId: "stallionx" });
  f.user = () => ({ ...common(), state: f.state, setup: f.setup, setupMessage: f.setupMessage, setupConflict: f.setupConflict, providerConnected: f.state !== "signed_out",
    ...(f.state !== "signed_out" ? { email: f.email, username: "reader" } : {}),
    ...(f.state === "authenticated" ? { profile: { id: f.accountID, username: "reader", email: f.email, balance: f.balance, status: 1, usedAmount: "3.25", groupName: "Standard", emailVerified: true, activeTokens: 1 } } : {}),
    ...(f.state === "unavailable" ? { message: "fixture account outage" } : {}),
  });
  // Legacy provider metadata intentionally remains connected for expired states:
  // the unified UI must never mistake this for an authenticated user session.
  f.legacy = () => ({ ...common(), signedIn: f.state !== "signed_out",
    ...(f.state !== "signed_out" ? { email: f.email, username: "reader", balance: "1.00" } : {}),
  });
  f.handle = async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    const json = data => route.fulfill({ json: data });
    const bad = (message, status = 400, extra = {}) => route.fulfill({ status, json: { error: message, ...extra } });
    if (url.origin !== origin) { f.unexpected.push(`${req.method()} ${url.href}`); return route.abort(); }
    if (p === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = ${JSON.stringify({ ...settings, web: !options.native })};` });
    if (p === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (p === "/favicon.ico") return route.fulfill({ status: 204 });
    if (p === "/api/window/main") { f.windows.push(Object.fromEntries(url.searchParams)); return json({}); }
    if (["/api/window/fit", "/api/window/tint"].includes(p)) return json({});
    if (f.guardWorkspace && p.startsWith("/api/") && !p.startsWith("/api/stallionx") && p !== "/api/fonts" && (f.state !== "authenticated" || f.setup !== "ready")) {
      f.blockedReads.push({ path: p, state: f.state, setup: f.setup });
      return bad("fixture workspace requires account setup", f.state === "authenticated" ? 409 : 401, { code: f.state === "authenticated" ? "user_setup_required" : "user_session_required" });
    }
    if (p === "/api/state") return json({ agents: [], profiles: [], settings, stallionxEnabled: true, updatesOff: true });
    if (p === "/api/settings") return json({ ...settings, version: "test", updatesOff: true });
    // the provider editor's "requests at once" pills read the lanes every 2s
    // while they show (refreshLanes in app.js), so a test that keeps the
    // editor open past that, as a busy machine does, asks for them. The
    // gateway's GET /api/lanes (providers.go) answers {} with nothing running.
    if (p === "/api/lanes" && req.method() === "GET") return json({});
    if (p === "/api/providers") {
      f.providerReads.push(f.state);
      return json(providerList());
    }
    if (["/api/provider/on", "/api/provider/off"].includes(p) && req.method() === "POST") {
      const body = req.postDataJSON(); f.posts.push({ path: p, body });
      f.providerOff[body.id] = p.endsWith("/off");
      return json(providerList());
    }
    if (p === "/api/stallionx" && req.method() === "GET") return json(f.legacy());
    if (p === "/api/stallionx/payers" && req.method() === "GET") return json(f.payerList());
    if (p.startsWith("/api/stallionx/payers/") && req.method() === "POST") {
      const body = req.postDataJSON() || {}; f.posts.push({ path: p, body });
      const team = f.teams.find(t => t.id === body.id);
      if (p.endsWith("/enable") || (p.endsWith("/default") && team)) {
        if (!team) return bad("not a team id");
        // a ready team wallet opens the workspace (user.go workspaceReady)
        team.enabled = true; f.setup = "ready"; f.setupMessage = "";
      }
      if (p.endsWith("/remove") && team) team.enabled = false;
      if (p.endsWith("/default")) { f.defaultPayer = body.id; f.payerAsk = false; }
      return json(f.payerList());
    }
    if (p === "/api/stallionx/user" && req.method() === "GET") {
      f.userReads.push(f.state);
      return f.userError ? bad(f.userError, 503) : json(f.user());
    }
    if (p.startsWith("/api/stallionx/") && req.method() === "POST") {
      const body = req.postDataJSON(); f.posts.push({ path: p, body });
      if (p === "/api/stallionx/code") return f.codeError ? bad(f.codeError) : json({});
      if (p === "/api/stallionx/signin") {
        if (f.holdSignIn) await f.holdSignIn;
        if (body.code !== "123456") return bad(wrongCode);
        f.email = body.email; f.state = "authenticated"; if (f.setupFail) { f.setup = "failed"; f.setupMessage = "fixture model sync failed"; } return json(f.user());
      }
      if (p === "/api/stallionx/signout") { f.state = "signed_out"; return json(f.user()); }
      if (p === "/api/stallionx/sync") { if (f.holdSetup) await f.holdSetup; f.setup = f.setupFail ? "failed" : "ready"; f.setupMessage = f.setupFail ? "fixture model sync failed" : ""; return json(f.user()); }
      if (p === "/api/stallionx/repair") { f.setup = "ready"; f.setupMessage = ""; f.setupConflict = false; return json(f.user()); }
    }
    if (p.startsWith("/api/stallionx/wallet/")) {
      const action = p.split("/").pop();
      f.reads.push({ action, query: Object.fromEntries(url.searchParams) });
      if (f.walletMissing) return route.fulfill({ status: 404, contentType: "text/plain", body: "404 page not found\n" });
      if (f.state !== "authenticated") return bad("expired", 401, { code: "user_session_required" });
      if (f.walletError) return bad(f.walletError, 503);
      if (action === "balance") return json({ balance: f.balance });
      if (action === "config") return json({ enabled: f.paymentEnabled, min_amount: "5", max_amount: "1000", preset_amounts: ["10", "25"], automatic_tax_enabled: true });
      if (action === "create") {
        const body = req.postDataJSON();
        const order = { public_id: "ord_fixture", amount: body.value, status: "pending", created_at: "2026-11-01T01:00:00Z", checkout_url: "https://checkout.stripe.com/fixture" };
        f.orders.unshift(order); return json({ order, checkout_url: order.checkout_url });
      }
      if (action === "orders") return json({ items: f.orders, total: f.orders.length });
      if (action === "redeem") {
        if (f.holdRedeem) await f.holdRedeem;
        if (f.redeemError) return bad(f.redeemError);
        f.balance = "22.123456"; return json({ balance: f.balance });
      }
      if (action === "keys") return json({ items: f.emptyKeys ? [] : f.keys || [{
        id: "token_fixture", name: "Desktop fixture", masked_key: "••••1234", status: 1,
        quota: "0", used_amount: "0.000001", period_type: "monthly", period_quota: "20.00", period_used_amount: "1.25",
        models: ["fixture-model"], allowed_ips: ["127.0.0.1"], created_at: "2026-11-01T00:00:00Z", last_used_at: null, expires_at: null,
      }], total: f.emptyKeys ? 0 : 21 });
      if (action === "logs") return json({ items: f.emptyLogs ? [] : f.logs || [{
        model: "fixture-model", request_id: "req_exact", created_at: "2026-11-01T01:00:00Z", cost: "0.000001", status: 1,
        prompt_tokens: 12, completion_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0,
        usage_known: false, billing_type: "token", input_price: "1.25", output_price: "10",
        token_name: "Desktop fixture", request_path: "/v1/chat/completions", client_ip: "127.0.0.1", user_agent: "Fixture client",
        is_stream: true, first_byte_time: 120, group_discount_rate: "0.8", cache_creation_1h_tokens: 7, cache_creation_1h_price: "2.50",
      }], total: f.emptyLogs ? 0 : url.searchParams.get("model") ? 1 : 21 });
    }
    if (p === "/api/provider/key") return json({ key: "sk-fixture-only" });
    if (p === "/api/groups") return json({ groups: [], models: [] });
    if (p === "/api/plugins") return json({ plugins: [] });
    if (p === "/api/plugin-pages") return json({ pages: [] });
    if (p === "/api/usage/quotas") return json([]);
    if (p === "/api/usage") return json({});
    if (p === "/api/usage/quotas/history") return json([]);
    if (["/api/update", "/api/upstream-status", "/api/login/usage", "/api/fonts", "/api/browser-access", "/api/plugins/updates",
      "/api/plugin-panels", "/api/davsync", "/api/cli", "/api/gateway/trace", "/api/upstream", "/api/importapps/discovery",
      "/api/agents/cli", "/api/plugins/agents", "/api/agents/install", "/api/whatsnew", "/api/drift", "/api/omarchy"].includes(p)) return json({});
    if (p.startsWith("/api/")) { f.unexpected.push(`${req.method()} ${p}`); return bad(`Unmocked API: ${p}`, 501); }
    if (p === f.assetFailure) return route.fulfill({ status: 503, contentType: "text/plain", body: "fixture module unavailable" });
    // Historical table/gate tests still exercise the retained legacy renderer;
    // console journey tests opt into the production Web bridge explicitly.
    if (p === '/stallionx-console-entry.js' && !options.console) return route.fulfill({ contentType: 'text/javascript', body: "const style=document.createElement('style'); style.textContent='html.stallionx-client #nav #stxWalletEntry {display:flex!important}'; document.head.append(style); window.stxConsoleNavigationState('ready'); await import('/stallionx-wallet.js'); window.stxOpenConsole = window.stxOpenWallet; window.stxLeaveConsole = window.stxLeaveWallet;" });
    const file = path.join(assets, p === "/" ? "index.html" : p);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" }[path.extname(file)];
    try { return await route.fulfill({ body: await fs.readFile(file), contentType }); }
    catch (error) { f.unexpected.push(`Asset ${p}: ${error.message}`); return route.fulfill({ status: 404, body: "" }); }
  };
  return f;
}

async function setup(ctx, engine, lang, width, initial, theme = "light", options = {}) {
  const browser = await (engine === "webkit" ? webkit.launch(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE } : {}) : chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chromium" }));
  ctx.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width, height: options.height || 850 }, deviceScaleFactor: options.zoom || 1, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
  const page = await context.newPage(); page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(60000);
  await page.addInitScript(() => { window.openedPayments = []; window.open = url => { window.openedPayments.push(url); return null; }; });
  const f = fixture(lang, initial, theme, options), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  ctx.after(() => { if (errors.length || f.unexpected.length) ctx.diagnostic(JSON.stringify({ errors, unexpected: f.unexpected })); });
  await context.route("**/*", f.handle);
  const user = page.locator("#stxWallet");
  const button = async label => {
    const scope = ["Overview", "Top up and redeem", "Payment orders", "Request billing", "API keys"].includes(label) ? user.locator(".stxw-tabs") : user;
    return scope.getByRole("button", { name: await tr(page, label), exact: true });
  };
  const press = async label => { const b = await button(label); await reach(page, b); await b.click(); };
  const verify = () => { assert.deepEqual(errors, [], "no uncaught page errors"); assert.deepEqual(f.unexpected, [], "all traffic stays in the explicit fixture"); };
  return { page, context, f, user, button, press, verify };
}

async function fits(page, locator) {
  await locator.waitFor({ state: "visible" });
  // Query and measure in one browser turn: provider redraws replace this card.
  const size = await locator.evaluateAll(nodes => {
    if (nodes.length !== 1) return null;
    const e = nodes[0], view = e.closest(".view") || e;
    return { self: e.scrollWidth - e.clientWidth, view: view.scrollWidth - view.clientWidth,
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  assert.ok(size, "one visible layout target");
  for (const [key, overflow] of Object.entries(size)) assert.ok(overflow <= 1, `${key} horizontal overflow: ${overflow}px`);
}

module.exports = { origin, email, languages, engines, wrongCode, tr, fixture, setup, fits, reach };
