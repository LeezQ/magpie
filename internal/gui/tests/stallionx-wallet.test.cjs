// Billing belongs to the unified authenticated user, never its own login.
// Real checked-in assets; no live backend, email or checkout requests.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { origin, engines, languages, tr, setup, fits } = require("./stallionx-fixture.cjs");

for (const engine of engines) for (const lang of languages) for (const width of [1100, 390]) {
  test(`${engine} ${lang} ${width}: authenticated billing, checkout, redemption and account expiry`, async ctx => {
    const { page, f, user, button, press, verify } = await setup(ctx, engine, lang, width, "authenticated");
    await page.goto(`${origin}/?view=stallion-wallet`);
    await user.getByRole("heading", { level: 2 }).waitFor();
    await user.getByText("$12.123456", { exact: true }).first().waitFor();
    assert.equal(await page.locator("#stxUserGate").isVisible(), false, "existing login opens account without another code");
    await press("Top up and redeem");
    const amount = user.getByRole("textbox", { name: await tr(page, "Amount (USD)"), exact: true });
    await amount.fill("10.255");
    await press("Create payment order");
    assert.equal(f.posts.filter(p => p.path.endsWith("/create")).length, 0, "invalid precision creates no order");
    await amount.fill("10.25");
    await press("Create payment order");
    await user.getByText("ord_fixture", { exact: true }).first().waitFor();
    assert.deepEqual(f.posts.filter(p => p.path.endsWith("/create")), [{ path: "/api/stallionx/wallet/create", body: { value: "10.25" } }]);
    await press("Pay in browser");
    assert.deepEqual(await page.evaluate(() => window.openedPayments), ["https://checkout.stripe.com/fixture"]);
    assert.equal(f.orders[0].status, "pending", "opening checkout never credits the order locally");
    f.orders[0].status = "paid"; delete f.orders[0].checkout_url;
    await press("Refresh");
    await user.getByText(await tr(page, "Payment credited"), { exact: true }).waitFor();
    assert.equal(await (await button("Pay in browser")).count(), 0);

    await press("Top up and redeem");
    const code = user.getByRole("textbox", { name: await tr(page, "Redemption code"), exact: true });
    await code.fill("TEST-CODE"); f.redeemError = "fixture refusal";
    await press("Redeem code");
    await user.getByRole("alert").filter({ hasText: "fixture refusal" }).waitFor();
    assert.equal(await code.inputValue(), "TEST-CODE", "refused redemption remains editable");
    f.redeemError = ""; await press("Redeem code");
    await user.getByText(/\$22\.123456/).first().waitFor();
    assert.equal(await code.inputValue(), "");
    await press("Overview");
    await user.getByText("$22.123456", { exact: true }).first().waitFor();

    // Personal key metadata uses the account session, not the locally selected
    // provider key. It remains read-only and never contains plaintext secrets.
    await press("API keys");
    await user.locator(".stxw-key-row").getByText("Desktop fixture", { exact: true }).waitFor();
    await user.locator(".stxw-key-row td").first().click();
    await user.locator(".stxw-key-detail").getByText("token_fixture", { exact: true }).waitFor();
    await user.locator(".stxw-key-row").getByText(await tr(page, "Key never expires"), { exact: true }).waitFor();
    await user.locator(".stxw-key-row").getByText("$0.000001", { exact: true }).waitFor();
    assert.equal(await user.getByText("sk-fixture-only", { exact: true }).count(), 0);
    await fits(page, user);
    await press("Next billing page");
    await user.getByText(await tr(page, "Page {page} · {total} records", { page: 2, total: 21 }), { exact: true }).waitFor();
    assert.ok(f.reads.some(r => r.action === "keys" && r.query.page === "2"));
    f.emptyKeys = true; await press("Refresh");
    await user.getByText(await tr(page, "No records for these filters."), { exact: true }).waitFor();
    f.emptyKeys = false;

    await press("Request billing");
    await user.locator(".stxw-log-row").getByText("$0.000001", { exact: true }).waitFor();
    await user.locator(".stxw-log-row td").first().click();
    const detail = user.locator(".stxw-log-detail");
    await detail.getByText(await tr(page, "Usage not reported"), { exact: true }).waitFor();
    assert.equal(await detail.getByText("req_exact", { exact: true }).count(), 1);
    await detail.getByText("/v1/chat/completions", { exact: true }).waitFor();
    await user.locator(".stxw-log-row").getByText("Desktop fixture", { exact: true }).waitFor();
    await detail.getByText("0.8", { exact: true }).waitFor();
    await detail.getByText("2.50", { exact: true }).waitFor();
    await press("Next billing page");
    await user.getByText(await tr(page, "Page {page} · {total} records", { page: 2, total: 21 }), { exact: true }).waitFor();
    await user.getByRole("searchbox", { name: await tr(page, "Exact model name") }).fill("fixture-model");
    await user.locator('input[type="date"]').nth(0).fill("2026-10-01");
    await user.locator('input[type="date"]').nth(1).fill("2026-10-02");
    await user.locator(".stxw-statuses").getByRole("button", { name: await tr(page, "Failed"), exact: true }).click();
    await press("Apply filters");
    await user.getByText(await tr(page, "Page {page} · {total} records", { page: 1, total: 1 }), { exact: true }).waitFor();
    const start = await page.evaluate(() => String(new Date("2026-10-01T00:00:00").getTime() / 1000));
    const end = await page.evaluate(() => String(new Date("2026-10-03T00:00:00").getTime() / 1000));
    assert.ok(f.reads.some(r => r.action === "logs" && r.query.model === "fixture-model" && r.query.page === "1" && r.query.status === "2" && r.query.start_timestamp === start && r.query.end_timestamp === end), "model, status and inclusive date range retain their server query semantics");
    await fits(page, user);
    f.walletError = "fixture billing outage"; await press("Refresh");
    await user.getByRole("alert").filter({ hasText: "fixture billing outage" }).waitFor();
    assert.equal(await page.locator("#stxUserGate").isVisible(), false, "billing outage does not log out the user");
    assert.equal(await user.locator(".stxw-log-row").count(), 1, "failed read keeps last good records");
    f.walletError = ""; f.walletMissing = true; await press("Refresh");
    await user.getByRole("alert").filter({ hasText: await tr(page, "Billing API is unavailable. Restart StallionX to load the updated backend.") }).waitFor();
    assert.equal(await page.locator("#stxUserGate").isVisible(), false, "non-JSON endpoint failure does not invalidate a session");
    assert.equal(await user.locator(".stxw-log-row").count(), 1, "non-JSON errors preserve the last successful read");
    f.walletMissing = false; f.emptyLogs = true; await press("Refresh");
    await user.getByText(await tr(page, "No records for these filters."), { exact: true }).waitFor();
    assert.equal(await user.locator(".stxw-log-row").count(), 0);
    f.emptyLogs = false;
    f.state = "expired";
    await press("Refresh");
    const gate = page.locator("#stxUserGate");
    await gate.waitFor();
    assert.equal(await page.locator("#stxWallet input[autocomplete='one-time-code']").count(), 0, "expiry returns to one global auth form");
    assert.equal(await gate.getByRole("textbox", { name: await tr(page, "Email"), exact: true }).inputValue(), f.email);
    await gate.getByRole("textbox", { name: await tr(page, "6-digit code"), exact: true }).fill("123456");
    await gate.getByRole("button", { name: await tr(page, "Sign in"), exact: true }).click();
    await gate.waitFor({ state: "hidden" });
    await press("Top up and redeem");
    f.paymentEnabled = false; await press("Refresh");
    await user.getByText(await tr(page, "Online payment is not enabled. You can still redeem a code."), { exact: true }).waitFor();
    assert.equal(await (await button("Create payment order")).count(), 0);
    assert.equal(f.posts.filter(p => p.path.endsWith("/verify")).length, 0);
    assert.equal(await page.locator("dialog.stx-wallet").count(), 0);
    verify();
  });
}

for (const engine of engines) {
  test(`${engine}: account replacement clears prior profile and discards held billing records`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, "en", 1100, "authenticated");
    await page.goto(`${origin}/?view=stallion-wallet`);
    await user.getByText(f.email, { exact: true }).first().waitFor();
    const oldEmail = f.email;
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; }), held = new Promise(resolve => { release = resolve; });
    await page.route("**/api/stallionx/wallet/logs?**", async route => {
      started(); await held;
      await route.fulfill({ json: { total: 1, items: [{ model: "prior-private-model", request_id: "prior-private-request", cost: "87.123", created_at: "2026-11-01T01:00:00Z", status: 1 }] } });
    });
    await press("Request billing"); await waiting;
    f.email = "second@example.com"; f.accountID = "second-user"; f.balance = "2.00";
    await page.evaluate(() => window.stxUser.refresh());
    await user.getByText(f.email, { exact: true }).first().waitFor();
    await user.getByText("second-user", { exact: true }).waitFor();
    await user.getByText("$2.00", { exact: true }).waitFor();
    const finished = page.waitForResponse(r => r.url().includes("/wallet/logs?"));
    release(); await finished;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await user.getByText(oldEmail, { exact: true }).count(), 0);
    assert.equal(await user.getByText("prior-private-model", { exact: true }).count(), 0, "stale billing cannot attach to the replacement account");
    assert.equal(await user.getByText("$12.123456", { exact: true }).count(), 0);
    verify();
  });

  test(`${engine}: an old unauthorized request cannot expire a newly signed-in account`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, "en", 1100, "authenticated");
    await page.goto(`${origin}/?view=stallion-wallet`);
    await user.getByText(f.email, { exact: true }).first().waitFor();
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; }), held = new Promise(resolve => { release = resolve; });
    await page.route("**/api/stallionx/wallet/balance?stale", async route => {
      started(); await held;
      await route.fulfill({ status: 401, json: { error: "old session expired", code: "user_session_required" } });
    });
    await page.evaluate(() => { window.fixtureStale = window.stxUser.request("wallet/balance?stale").catch(e => e.code); });
    await waiting;
    await press("Sign out"); await press("Confirm sign out");
    const gate = page.locator("#stxUserGate");
    await gate.getByRole("textbox", { name: "Email", exact: true }).fill("new-session@example.com");
    await gate.getByRole("textbox", { name: "6-digit code", exact: true }).fill("123456");
    await gate.getByRole("button", { name: "Sign in", exact: true }).click();
    await gate.waitFor({ state: "hidden" });
    await user.getByText("new-session@example.com", { exact: true }).first().waitFor();
    release(); assert.equal(await page.evaluate(() => window.fixtureStale), "user_session_required");
    assert.equal(await page.evaluate(() => window.stxUser.current.state), "authenticated");
    assert.equal(await gate.isVisible(), false);
    verify();
  });
}
