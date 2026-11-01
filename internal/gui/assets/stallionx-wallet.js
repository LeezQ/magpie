// An additive account surface. No replacement of upstream views or renderers.
(() => {
  if (!stxUI.enabled || mode !== "window") return;
  const dialog = $("#stxWallet");
  let confirmOut = false;
  let tab = "overview", page = 1, generation = 0, busy = false, session = false, current = null;
  let accountGeneration = 0;
  let data = null, config = null, balance = null, error = "", notice = "", loading = false;
  let filters = { model: "", status: "", from: "", through: "" };
  const amount = field("Amount (USD)", "text"), code = field("Redemption code", "text");
  amount.inputMode = "decimal";
  function field(label, type) {
    const n = el("input", "words"); n.type = type; n.setAttribute("aria-label", t(label)); n.placeholder = t(label); n.title = t(label); return n;
  }
  function button(label, action, primary = false) {
    const n = el("button", "text" + (primary ? " action primary" : ""), t(label));
    n.type = "button"; n.onclick = action; n.disabled = busy; return n;
  }
  function note(text) { return el("p", "stxw-note", t(text)); }
  function value(v) { return v == null || v === "" ? t("Billing unavailable") : String(v); }
  function money(v) { return v == null || v === "" ? t("Billing unavailable") : "$" + String(v); }
  function date(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? value(v) : d.toLocaleString(intlLang()); }
  function pair(box, label, v) {
    const row = el("div", "row pref stxw-pair"), who = el("div", "who");
    who.append(el("span", "name", t(label))); row.append(who, el("strong", "stxw-value", value(v))); box.append(row);
  }
  async function call(action, body, query = "") {
    const version = accountGeneration;
    const result = await window.stxUser.request("wallet/" + action + query, body);
    if (version !== accountGeneration) throw new Error("Account changed");
    return result;
  }
  function leave() {
    generation++;
    code.value = "";
    queueMicrotask(() => window.stxUser.apply());
  }
  async function openWallet() {
    if (busy) { draw(); return; }
    await load();
  }
  async function load() {
    const version = ++generation;
    loading = true; error = ""; draw();
    try {
      const account = await window.stxUser.refresh();
      if (version !== generation) return;
      if (current?.email !== account.email || current?.service !== account.service) {
        session = false; data = config = balance = null;
        code.value = "";
      }
      current = account;
      if (account?.state !== "authenticated") { session = false; data = balance = config = null; return; }
      balance = account.profile?.balance; session = true;
      if (tab === "overview") return;
      const query = new URLSearchParams({ page: String(page), page_size: "20" });
      if (tab === "logs") {
        if (filters.model) query.set("model", filters.model);
        if (filters.status) query.set("status", filters.status);
        if (filters.from) query.set("start_timestamp", String(new Date(filters.from + "T00:00:00").getTime() / 1000));
        if (filters.through) {
          const end = new Date(filters.through + "T00:00:00"); end.setDate(end.getDate() + 1);
          query.set("end_timestamp", String(end.getTime() / 1000));
        }
      }
      const [freshBalance, result] = await Promise.all([
        call("balance"), call(tab === "topup" ? "config" : tab, undefined, tab === "topup" ? "" : "?" + query),
      ]);
      if (version !== generation) return;
      if (freshBalance?.balance == null || !result || (tab !== "topup" && (!Array.isArray(result.items) || !Number.isFinite(result.total)))) throw new Error(t("Billing unavailable"));
      balance = freshBalance.balance; session = true;
      if (tab === "topup") config = result; else data = result;
    } catch (e) {
      if (version !== generation) return;
      if (e.code === "user_session_required" || e.code === "wallet_session_required") { session = false; data = balance = config = null; }
      else error = e.message;
    } finally {
      if (version === generation) { loading = false; draw(); }
    }
  }
  async function mutate(work, financial = false) {
    if (busy) return;
    const version = accountGeneration;
    busy = true; error = notice = ""; draw();
    try { await work(); }
    catch (e) {
      if (version !== accountGeneration) return;
      if (e.code === "user_session_required" || e.code === "wallet_session_required") { session = false; data = config = balance = null; }
      error = e.code === "user_session_required" ? "" : e.message + (financial ? " · " + t("Result uncertain. Refresh orders and balance before trying again.") : "");
    } finally { if (version === accountGeneration) { busy = false; draw(); } }
  }
  function switchTab(next) {
    if (busy || tab === next) return;
    tab = next; page = 1; data = null; notice = ""; load();
  }
  function draw() {
    const head = el("header", "usage-head stxw-head");
    head.append(el("h2", "sr-only", t("User center")));
    const tabs = segs([["overview", "Overview"], ["topup", "Top up and redeem"], ["orders", "Payment orders"], ["logs", "Request billing"], ["keys", "API keys"]].map(([id, label]) => [id, t(label)]), tab, switchTab);
    tabs.classList.add("stxw-tabs"); tabs.setAttribute("aria-label", t("Stallion account"));
    for (const b of tabs.querySelectorAll("button")) b.disabled = busy;
    head.append(tabs);
    const body = el("div", "stxw-body");
    if (current?.state === "authenticated" && tab !== "overview") {
      const summary = el("div", "stxw-summary");
      summary.append(el("span", "", current.email), el("strong", "", t("Server balance (USD)") + " · " + money(balance)));
      const refresh = button("Refresh", () => load()); refresh.disabled = busy || loading; summary.append(refresh); body.append(summary);
    }
    if (loading) body.append(note("Loading billing…"));
    if (error) { const n = el("p", "stxw-error", error); n.setAttribute("role", "alert"); body.append(n); }
    if (notice) { const n = el("p", "stxw-notice", notice); n.setAttribute("role", "status"); body.append(n); }
    if (session && current?.setup !== "ready") {
      const setup = el("section", "list stxw-section"), row = el("div", "row pref stxw-setup"), who = el("div", "who");
      who.append(el("div", "name", t("Workspace setup needs attention")), el("p", "sub", current.setupMessage || t("Your account is signed in. Stallion will configure your access key and available models automatically.")));
      row.append(who, button("Retry setup", async () => { await window.stxUser.sync(); await load(); })); setup.append(row);
      if (current.setupConflict) setup.append(window.stxUser.repairControls());
      body.append(setup);
    }
    if (session && !loading) {
      if (tab === "overview") overview(body);
      if (tab === "topup" && config) topup(body);
      if (tab === "logs") logFilters(body);
      if (tab !== "topup" && tab !== "overview" && data) records(body);
    }
    dialog.replaceChildren(head, body);
  }
  function overview(body) {
    const p = current.profile || {}, profile = el("section", "list stxu-profile");
    const identityRow = el("div", "row pref"), who = el("div", "who");
    who.append(el("div", "name", p.username || current.username || t("User center")), el("p", "sub", p.email || current.email || ""));
    identityRow.append(who); profile.append(identityRow);
    pair(profile, "Account ID", p.id);
    pair(profile, "Account status", t("Signed in"));
    pair(profile, "Model access", t(current.setup === "ready" ? "Configured automatically" : "Workspace setup needs attention"));
    if (p.groupName) pair(profile, "Account group", p.groupName);
    pair(profile, "Server balance (USD)", money(p.balance));
    const actions = el("div", "row pref stxw-actions");
    actions.append(button("Top up and redeem", () => switchTab("topup"), true), button("Request billing", () => switchTab("logs")), button("API keys", () => switchTab("keys")));
    profile.append(actions); body.append(profile);
    const tools = el("div", "stxw-account-row");
    tools.append(note("Your account and available models are synced from Stallion. No manual API configuration is needed."));
    const controls = el("div", "stxw-actions");
    controls.append(button("Refresh", () => load()));
    if (confirmOut) {
      body.append(note("Signing out locks this app and disconnects its managed model access on this computer."));
      controls.append(button("Confirm sign out", async () => { confirmOut=false; await window.stxUser.signOut(); }), button("Cancel", () => {confirmOut=false;draw();}));
    } else controls.append(button("Sign out", () => {confirmOut=true;draw();}));
    tools.append(controls); body.append(tools);
  }
  function topup(body) {
    body.append(note("Payment opens in your browser. Return here and refresh to confirm credit; opening checkout does not mean payment succeeded."));
    if (config.enabled) {
      const section = el("section", "list stxw-section"), content = el("div", "row pref stxw-form-row"); content.append(el("div", "name", t("Amount (USD)")));
      const presets = el("div", "stxw-form");
      for (const n of config.preset_amounts || []) presets.append(button(money(n), () => { amount.value = String(n); }));
      const form = el("form", "stxw-form"), pay = button("Create payment order", () => form.requestSubmit(), true);
      amount.disabled = busy;
      form.append(amount, pay);
      form.onsubmit = (e) => {
        e.preventDefault(); const v = amount.value.trim();
        if (!/^\d+(\.\d{1,2})?$/.test(v) || Number(v) <= 0 || Number(v) < Number(config.min_amount) || Number(v) > Number(config.max_amount)) {
          error = t("Enter a valid amount within the displayed limits (up to two decimals)."); draw(); return;
        }
        mutate(async () => {
          await call("create", { value: v });
          tab = "orders"; page = 1; data = null;
          notice = t("Payment opens in your browser. Return here and refresh to confirm credit; opening checkout does not mean payment succeeded.");
          await load();
        }, true);
      };
      content.append(presets, form, el("p", "stxw-note", money(config.min_amount) + " – " + money(config.max_amount)));
      if (config.automatic_tax_enabled) content.append(note("Tax may be added at checkout."));
      section.append(content); body.append(section);
    } else body.append(note("Online payment is not enabled. You can still redeem a code."));
    const section = el("section", "list stxw-section"), form = el("form", "stxw-form"), content = el("div", "row pref stxw-form-row");
    content.append(el("div", "name", t("Redemption code")));
    code.disabled = busy;
    form.append(code, button("Redeem code", () => form.requestSubmit(), true));
    form.onsubmit = (e) => { e.preventDefault(); if (code.value.trim()) mutate(async () => {
      const result = await call("redeem", { value: code.value.trim() });
      code.value = ""; balance = result.balance;
      notice = t("Code redeemed. Refresh to read the latest balance.");
    }, true); };
    content.append(form); section.append(content); body.append(section);
  }
  function logFilters(body) {
    body.append(note("Actual charges from Stallion, not local estimates. All requests on this account are included."));
    const form = el("form", "stxw-filters"), model = field("Exact model name", "search"), from = field("From date", "date"), through = field("Through date", "date");
    model.value = filters.model; from.value = filters.from; through.value = filters.through;
    const states = segs(["", "1", "2", "3", "4"].map(id => [id, t(logStatus(id))]), filters.status, id => {
      filters = { model: model.value.trim(), from: from.value, through: through.value, status: id };
    });
    states.classList.add("stxw-statuses");
    for (const b of states.querySelectorAll("button")) b.disabled = busy;
    const fields = el("div", "stxw-filter-fields");
    for (const [label, node, kind] of [["Exact model name", model, "model"], ["From date", from, "date"], ["Through date", through, "date"]]) {
      const wrapper = el("label", "stxw-filter-field stxw-filter-" + kind);
      wrapper.append(el("span", "", t(label)), node); fields.append(wrapper);
    }
    const actions = el("div", "stxw-filter-actions"), apply = button("Apply filters", () => form.requestSubmit());
    apply.classList.add("action"); actions.append(states, apply);
    form.append(fields, actions);
    form.onsubmit = (e) => {
      e.preventDefault(); filters = { ...filters, model: model.value.trim(), from: from.value, through: through.value };
      if (filters.from && filters.through && filters.from > filters.through) { error = t("End date must not precede start date."); draw(); return; }
      page = 1; data = null; load();
    };
    body.append(form);
  }
  function logStatus(s) { return ({ "1": "Request succeeded", "2": "Failed", "3": "Request cancelled", "4": "Unfinished" })[s] || "All statuses"; }
  function orderStatus(s) { return ({ pending: "Payment pending", paid: "Payment credited", failed: "Failed", expired: "Expired", refunded: "Refunded", partially_refunded: "Partially refunded" })[s] || s; }
  // Key metadata is redacted by the Go boundary, not merely hidden with CSS.
  // This view is deliberately read-only: inspecting an account must not rotate,
  // disable or remove the key the desktop or another application is using.
  function keyDetails(detail, item) {
    pair(detail, "API key", item.masked_key);
    pair(detail, "Account key ID", item.id);
    pair(detail, "Key spending limit (USD)", Number(item.quota) === 0 && item.quota != null ? t("Unlimited") : money(item.quota));
    pair(detail, "Key spending (USD)", money(item.used_amount));
    if (item.period_type) {
      pair(detail, "Key quota period", t(({ daily: "Daily key quota", weekly: "Weekly key quota", monthly: "Monthly key quota" })[item.period_type] || item.period_type));
      pair(detail, "Period limit (USD)", money(item.period_quota));
      pair(detail, "Period spending (USD)", money(item.period_used_amount));
    }
    pair(detail, "Models", item.models?.length ? item.models.join(", ") : t("All models"));
    pair(detail, "Allowed key IPs", item.allowed_ips?.length ? item.allowed_ips.join(", ") : t("Unlimited"));
    pair(detail, "Key created at", item.created_at ? date(item.created_at) : null);
    pair(detail, "Key last used at", item.last_used_at ? date(item.last_used_at) : t("Key never used"));
    pair(detail, "Key expires at", item.expires_at ? date(item.expires_at) : t("Key never expires"));
  }
  function logDetails(detail, item) {
    pair(detail, "Request ID", item.request_id);
    pair(detail, "Name", item.token_name);
    if (item.team_name || item.team_id) pair(detail, "Request workspace", item.team_name || item.team_id);
    pair(detail, "Request endpoint", item.request_path);
    pair(detail, "Request client IP", item.client_ip);
    if (item.user_agent) pair(detail, "Request user agent", item.user_agent);
    pair(detail, "Streaming", item.is_stream == null ? null : t(item.is_stream ? "On" : "Off"));
    if (item.is_stream === true && item.first_byte_time > 0) pair(detail, "First response (ms)", item.first_byte_time);
    if (item.error_message) pair(detail, "Error", item.error_message);
    // Persisted cost is authoritative, including failed/cancelled requests.
    // Do not recompute or round it from the displayed pricing snapshots.
    pair(detail, "Actual charge (USD)", money(item.cost));
    if (item.group_discount_rate != null) pair(detail, "Account billing multiplier", item.group_discount_rate);
    if (item.usage_known === false) detail.append(note("Usage not reported"));
    for (const [key, label] of [["prompt_tokens", "Input tokens (uncached)"], ["cache_read_tokens", "Cache read tokens"], ["cache_creation_tokens", "Cache write tokens"], ["cache_creation_1h_tokens", "One-hour cache writes (included above)"], ["completion_tokens", "Output tokens"], ["request_time", "Duration (ms)"], ["billing_type", "Billing type"], ["input_price", "Input price (USD / million)"], ["output_price", "Output price (USD / million)"], ["cache_read_price", "Cache read price (USD / million)"], ["cache_creation_price", "Cache write price (USD / million)"], ["cache_creation_1h_price", "One-hour cache price (USD / million)"], ["call_price", "Price per call (USD)"]]) {
      pair(detail, label, item.usage_known === false && key.endsWith("tokens") ? null : item[key]);
    }
  }
  const missing = "\u2014";
  const tableValue = v => v == null || v === "" ? missing : String(v);
  const tableMoney = v => v == null || v === "" ? missing : money(v);
    const count = v => Number.isSafeInteger(v) && v >= 0 ? v.toLocaleString(intlLang()) : missing;
    const millis = v => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v.toLocaleString(intlLang()) + " ms" : missing;
  function timeCell(v, fallback = missing) {
    if (v == null || v === "") return el("span", "stxw-table-muted", fallback);
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return el("span", "stxw-table-muted", missing);
    const n = el("time", "stxw-table-time"); n.dateTime = d.toISOString(); n.title = date(v);
      n.append(el("span", "", d.toLocaleDateString(intlLang())), el("span", "stxw-table-muted", d.toLocaleTimeString(intlLang())));
    return n;
  }
  function inputTokens(item) {
    // One-hour cache writes are already part of cache_creation_tokens.
    const parts = [item.prompt_tokens, item.cache_read_tokens, item.cache_creation_tokens];
    return item.usage_known === false || parts.some(n => !Number.isSafeInteger(n) || n < 0) ? missing : count(parts.reduce((a, b) => a + b, 0));
  }
  function recordTable() {
    const keys = tab === "keys", kind = keys ? "key" : "log", title = keys ? "API keys" : "Request billing";
    const columns = keys ? [
      ["Name", "name"], ["API key", "key"], ["Status", "status"], ["Key spending limit (USD)", "num"], ["Key spending (USD)", "num cost"],
      ["Key created at", "time"], ["Key last used at", "time"], ["Key expires at", "time"], ["Key details", "toggle"],
    ] : [
      ["Time", "time"], ["Request key", "name"], ["Request scope", "scope"], ["Model", "model"], ["Request mode", "mode"],
      ["Input tokens", "num"], ["Output tokens", "num"], ["Cost", "num cost"], ["Duration", "num duration"], ["TTFT", "num"],
      ["Status", "status"], ["Request details", "toggle"],
    ];
    const scroll = el("div", `list stxw-table-scroll stxw-${kind}-scroll`), table = el("table", `stxw-table stxw-${kind}-table`);
    scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", t(title));
    table.append(el("caption", "sr-only", t(title)));
    const head = el("thead"), header = el("tr");
    for (const [label, cls] of columns) {
      const th = el("th", "stxw-col-" + cls.split(" ")[0]); th.scope = "col";
      th.append(el("span", cls === "toggle" ? "sr-only" : "", t(label)));
      if (label === "Input tokens") th.title = t("Input includes uncached, cache-read and cache-write tokens.");
      if (label === "TTFT") th.title = t("First response (ms)");
      header.append(th);
    }
    head.append(header); table.append(head);
    const rows = el("tbody");
    for (const [index, item] of (data.items || []).entries()) {
      const row = el("tr", `stxw-table-row stxw-${kind}-row`), detail = el("tr", `stxw-table-detail stxw-${kind}-detail`);
      detail.id = `stxw-${kind}-detail-${index}`; detail.hidden = true;
      const cell = el("td"), content = el("div", "stxw-detail-content"); cell.colSpan = columns.length;
      const label = keys ? "Key details" : "Request details";
      const toggle = button(label, () => {
        detail.hidden = !detail.hidden;
        toggle.setAttribute("aria-expanded", String(!detail.hidden));
        row.classList.toggle("stxw-expanded", !detail.hidden);
        if (!detail.hidden && !content.childElementCount) (keys ? keyDetails : logDetails)(content, item);
      });
      toggle.classList.add("stxw-table-toggle"); toggle.setAttribute("aria-label", t(label)); toggle.title = t(label);
      toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", detail.id);
      toggle.replaceChildren(svg(CHEV_R, 12, 1.7));
      const status = el("span", "stxw-table-status", keys ? t(({ 1: "On", 2: "Off" })[item.status] || tableValue(item.status)) : (item.status >= 1 && item.status <= 4 ? t(logStatus(String(item.status))) : missing));
      if (Number(item.status) === 1) status.classList.add("stxw-status-ok");
      else if (!keys && Number(item.status) === 2) status.classList.add("stxw-status-error");
      const model = el("span", "stxw-table-model", tableValue(item.model));
      // Match Stallion's public scope convention; absent identity stays unknown.
      const scope = item.team_name || item.team_id || (item.team_id === "" ? t("Personal workspace") : missing);
      const values = keys ? [
        tableValue(item.name), tableValue(item.masked_key), status,
        item.quota != null && Number(item.quota) === 0 ? t("Unlimited") : tableMoney(item.quota), tableMoney(item.used_amount),
        timeCell(item.created_at), timeCell(item.last_used_at, t("Key never used")), timeCell(item.expires_at, t("Key never expires")), toggle,
      ] : [
        timeCell(item.created_at), tableValue(item.token_name), scope, model,
        item.is_stream === true ? t("Streaming") : item.is_stream === false ? t("Non-streaming") : missing,
        inputTokens(item), item.usage_known === false ? missing : count(item.completion_tokens), tableMoney(item.cost), millis(item.request_time),
        item.is_stream === true && item.first_byte_time > 0 ? millis(item.first_byte_time) : missing, status, toggle,
      ];
      values.forEach((v, i) => {
        const td = el("td", columns[i][1].split(" ").map(cls => "stxw-col-" + cls).join(" "));
        td.append(v); row.append(td);
      });
      row.onclick = e => {
        if (!e.target.closest("button") && !window.getSelection()?.toString()) toggle.click();
      };
      cell.append(content); detail.append(cell); rows.append(row, detail);
    }
    if (!data.items?.length) {
      const row = el("tr"), cell = el("td", "empty-state", t("No records for these filters."));
      cell.colSpan = columns.length; row.append(cell); rows.append(row);
    }
    table.append(rows); scroll.append(table); return scroll;
  }
  function records(body) {
    if (tab === "keys") body.append(note("Personal account keys are read-only here. Full secrets are never loaded into this page."));
    const list = tab === "orders" ? el("div", "list stxw-records") : recordTable();
    if (tab === "orders" && !data.items?.length) list.append(el("p", "empty-state", t("No records for these filters.")));
    for (const item of tab === "orders" ? data.items || [] : []) {
      const detail = el("details", "stxw-record"), summary = el("summary", "row");
      summary.append(el("span", "stxw-record-title", value(item.public_id)),
        el("span", "", date(item.created_at)), el("span", "", t(orderStatus(item.status))), el("strong", "", money(item.amount)));
      const chev = el("span", "chev"); chev.append(svg(CHEV_R, 11, 1.7)); summary.append(chev);
      detail.append(summary);
      if (tab === "orders") {
        pair(detail, "Payment orders", item.public_id);
        pair(detail, "Amount (USD)", money(item.amount));
        if (item.failure_reason) detail.append(el("p", "stxw-error", item.failure_reason));
        if (item.refunded_amount != null) pair(detail, "Refunded", money(item.refunded_amount));
        if (item.checkout_url) {
          const pay = button("Pay in browser", () => {
            try {
              const url = new URL(item.checkout_url);
              if (url.protocol !== "https:" || url.username || url.password) throw new Error(t("Billing unavailable"));
              api("open", { url: url.href }).catch((e) => { error = e.message; draw(); });
            } catch (e) { error = e.message; draw(); }
          }, true);
          detail.append(pay); detail.open = item.status === "pending";
        }
      }
      list.append(detail);
    }
    const pagination = el("div", "stxw-pagination");
    const prev = button("Previous billing page", () => { page--; load(); }), next = button("Next billing page", () => { page++; load(); });
    prev.disabled = busy || loading || page <= 1; next.disabled = busy || loading || page * 20 >= data.total;
    const controls = el("div", "stxw-page-controls"); controls.append(prev, next);
    pagination.append(el("span", "", t("Page {page} · {total} records", { page, total: data.total })), controls);
    body.append(list, pagination);
  }
  window.stxUser.subscribe(u => {
    const identity = account => account?.state === "authenticated" ? [account.service, account.email, account.profile?.id].join("\n") : "";
    const sameAccount = identity(current) === identity(u);
    const keepView = sameAccount && session && u?.state === "authenticated" && tab !== "overview" &&
      ["setup", "setupMessage", "setupConflict", "providerConnected"].every(key => current?.[key] === u[key]);
    if (!sameAccount) {
      // Other app windows share the backend session. Never leave the previous
      // user's records or an in-flight mutation attached to the new account.
      generation++; accountGeneration++;
      data = config = balance = null; busy = loading = confirmOut = false;
      code.value = amount.value = error = notice = ""; tab = "overview"; page = 1;
      filters = { model: "", status: "", from: "", through: "" };
    }
    current = u; session = u?.state === "authenticated";
    if (session) balance = u.profile?.balance;
    else data = config = balance = null;
    // Background account polling must not close a disclosure, lose table
    // scroll/focus or discard filter drafts while the reader is using them.
    if (keepView) {
      const summary = dialog.querySelector(".stxw-summary strong");
      if (summary) summary.textContent = t("Server balance (USD)") + " · " + money(balance);
    } else draw();
  });
  window.stxOpenWallet = openWallet;
  window.stxLeaveWallet = leave;
})();
