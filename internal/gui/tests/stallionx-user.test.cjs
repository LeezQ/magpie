// The mandatory commercial-client journey: one login gate, automatic setup,
// profile and wallet share that session, and sign-out gates every workspace.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { origin, email, engines, languages, wrongCode, tr, setup, fits } = require("./stallionx-fixture.cjs");

for (const engine of engines) for (const lang of languages) for (const width of [1100, 390]) {
  test(`${engine} ${lang} ${width}: unified login, setup, profile, restart and global sign-out`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, lang, width, "signed_out");
    await page.goto(`${origin}/?view=providers`);
    const gate = page.locator("#stxUserGate");
    await gate.waitFor();
    const gateButton = async label => gate.getByRole("button", { name: await tr(page, label), exact: true });
    const address = gate.getByRole("textbox", { name: await tr(page, "Email"), exact: true });
    await address.waitFor();
    await fits(page, gate);
    if (process.env.ARTIFACT_DIR && lang === "zh") await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/gate-${engine}-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("stx-user-locked")), true, "workspace stays locked until authenticated setup succeeds");
    assert.equal(await page.locator('#stxAccount input').count(), 0, "provider card has no second login form");
    assert.equal(await page.locator('#stxWallet input[autocomplete="one-time-code"]').count(), 0, "wallet has no separate verification form");
    await address.fill(email);
    const send = await gateButton("Send code");
    const sendStyle = await send.evaluate(e => {
      const s = getComputedStyle(e), box = e.getBoundingClientRect();
      return { width: box.width, height: box.height, border: parseFloat(s.borderTopWidth), background: s.backgroundColor, opacity: Number(s.opacity) };
    });
    assert.ok(sendStyle.width > 60 && sendStyle.height >= (width <= 600 ? 44 : 27) && sendStyle.opacity >= 0.8, "Send code uses the original visible action-button size");
    assert.ok(sendStyle.border > 0 || !["transparent", "rgba(0, 0, 0, 0)"].includes(sendStyle.background), "Send code has a visible button boundary");
    await send.click();
    const code = gate.getByRole("textbox", { name: await tr(page, "6-digit code"), exact: true });
    await code.waitFor();
    assert.equal(f.posts.filter(p => p.path === "/api/stallionx/code").length, 1);
    assert.deepEqual(f.posts.find(p => p.path === "/api/stallionx/code").body, { email, locale: lang });
    assert.equal(await gate.locator("#stxSendCode").isDisabled(), true, "resend cooldown starts immediately");
    assert.match(await gate.locator("#stxSendCode").textContent(), /\d+/, "resend displays remaining seconds");
    const invite = gate.getByRole("textbox", { name: await tr(page, "Invite code (optional)"), exact: true });
    await invite.fill("fixture-invite");
    await code.fill("000000");
    await (await gateButton("Sign in")).click();
    await gate.getByRole("alert").filter({ hasText: wrongCode }).waitFor();
    assert.equal(await code.inputValue(), "000000", "refusal preserves the entered code");
    assert.equal(await invite.inputValue(), "fixture-invite", "refusal preserves referral");
    assert.equal(f.state, "signed_out");
    await code.fill("123456");
    await (await gateButton("Sign in")).click();
    await gate.waitFor({ state: "hidden" });
    assert.equal(f.state, "authenticated");
    assert.equal(await page.evaluate(() => window.stxUser.current.state), "authenticated", "login response supplies canonical account state");
    await page.locator("#stxWalletEntry").click();
    await user.getByRole("heading", { level: 2 }).waitFor();
    await user.getByText(email, { exact: true }).first().waitFor();
    await user.getByText("$12.123456", { exact: true }).first().waitFor();
    assert.equal(await user.getByRole("textbox", { name: await tr(page, "6-digit code"), exact: true }).count(), 0, "signed-in account never re-verifies for billing");
    assert.equal(await user.getByRole("button", { name: await tr(page, "Sign in"), exact: true }).count(), 0);
    assert.equal(await page.locator("dialog.stx-wallet").count(), 0, "user center is a normal page");
    await fits(page, user);
    if (process.env.ARTIFACT_DIR && lang === "zh") await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/user-${engine}-${width}.png` });

    // Reload represents another webview or restart against the saved backend
    // session. No email/login request may be repeated to access the center.
    const postsBeforeReload = f.posts.length;
    await page.reload();
    await user.getByText(email, { exact: true }).first().waitFor();
    assert.equal(await gate.isVisible(), false);
    assert.equal(f.posts.length, postsBeforeReload, "session restoration does not mail a code or sign in again");
    assert.equal(await page.locator("#stxWalletEntry").textContent(), await tr(page, "User center"), "navigation keeps the user-center label after restoration");
    await press("Sign out");
    assert.equal(f.posts.filter(p => p.path === "/api/stallionx/signout").length, 0, "signout requires confirmation");
    await press("Cancel");
    assert.equal(f.state, "authenticated");
    await press("Sign out");
    await press("Confirm sign out");
    await gate.waitFor();
    assert.equal(f.state, "signed_out");
    await page.goto(`${origin}/?view=usage`);
    await gate.waitFor();
    // the gate shows before the user state answers and draws its form after
    // (stallionx-user.js): wait for the form, then count what it holds
    const emailBox = gate.getByRole("textbox", { name: await tr(page, "Email"), exact: true });
    await emailBox.first().waitFor();
    assert.equal(await emailBox.count(), 1, "deep links stay behind the same global login gate");
    assert.equal(f.posts.filter(p => p.path.includes("/wallet/verify")).length, 0, "no wallet-only authentication endpoint");
    verify();
  });
}

// Failures must keep the workspace gated without pretending the user signed
// out. A held setup response makes the transition deterministic.
for (const engine of engines) {
  test(`${engine}: setup failure and connection outage cannot expose the workspace`, async ctx => {
    const { page, f, verify } = await setup(ctx, engine, "zh", 390, "authenticated");
    f.setup = "failed"; f.setupMessage = "fixture model sync failed"; f.setupFail = true;
    await page.goto(`${origin}/?view=agents`);
    const gate = page.locator("#stxUserGate");
    await gate.getByText("fixture model sync failed", { exact: true }).waitFor();
    assert.equal(await gate.getByRole("textbox", { name: await tr(page, "Email"), exact: true }).count(), 0, "setup failure is not a second login");
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("stx-user-locked")), true);
    let release;
    f.holdSetup = new Promise(resolve => { release = resolve; });
    f.setupFail = false;
    await gate.getByRole("button", { name: await tr(page, "Retry setup"), exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#stxUserGate button')?.disabled === true);
    assert.equal(await gate.isVisible(), true, "workspace remains blocked while setup runs");
    release();
    await gate.waitFor({ state: "hidden" });
    assert.equal(f.posts.filter(p => p.path === "/api/stallionx/sync").length, 1);
    assert.equal(f.posts.filter(p => p.path === "/api/stallionx/signin").length, 0, "setup retry does not sign in again");
    f.state = "unavailable";
    await page.reload();
    await gate.getByText("fixture account outage", { exact: true }).waitFor();
    assert.equal(await gate.getByRole("textbox", { name: await tr(page, "Email"), exact: true }).count(), 0, "network failure does not invent logged-out state");
    f.state = "authenticated";
    await gate.getByRole("button", { name: await tr(page, "Retry connection"), exact: true }).click();
    await gate.waitFor({ state: "hidden" });
    f.state = "unavailable";
    await page.reload();
    await gate.getByRole("button", { name: await tr(page, "Sign out"), exact: true }).click();
    await gate.getByRole("textbox", { name: await tr(page, "Email"), exact: true }).waitFor();
    assert.equal(f.state, "signed_out", "a broken session can be explicitly cleared without reconnecting");
    verify();
  });

  test(`${engine}: incomplete workspace setup still permits funding the signed-in account`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, "zh", 390, "authenticated");
    f.setup = "failed"; f.setupMessage = "fixture insufficient balance"; f.setupFail = true;
    await page.goto(`${origin}/?view=providers`);
    const gate = page.locator("#stxUserGate");
    await gate.getByText(f.setupMessage, { exact: true }).waitFor();
    await gate.getByRole("button", { name: await tr(page, "Open user center"), exact: true }).click();
    await user.getByText(f.setupMessage, { exact: true }).waitFor();
    assert.equal(await gate.isVisible(), false, "authenticated account pages do not depend on model setup");
    assert.deepEqual(await page.locator("#nav button[data-view]:visible").evaluateAll(nodes => nodes.map(n => n.dataset.view)), ["stallion-wallet"], "only account navigation is available before setup completes");
    assert.equal(await page.locator("#prefs").isVisible(), false);
    await press("Top up and redeem");
    await user.getByRole("textbox", { name: await tr(page, "Redemption code"), exact: true }).fill("FUND-SETUP");
    await press("Redeem code");
    await user.getByText(/\$22\.123456/).first().waitFor();
    await press("Payment orders");
    await press("Request billing");
    await user.locator(".stxw-log-row").getByText("$0.000001", { exact: true }).waitFor();
    assert.equal(f.setup, "failed", "funding does not invent successful model setup");
    await page.reload();
    await user.getByText(f.setupMessage, { exact: true }).waitFor();
    assert.equal(await gate.isVisible(), false, "an authenticated direct account URL remains reachable before setup");
    f.setupFail = false;
    await press("Retry setup");
    await page.waitForFunction(() => !document.documentElement.classList.contains("stx-account-only"));
    await page.locator('#nav button[data-view="providers"]').click();
    await page.locator("#view-providers").waitFor();
    assert.equal(await gate.isVisible(), false);
    assert.equal(f.posts.filter(p => p.path === "/api/stallionx/signin").length, 0, "financing and setup share the saved session");
    assert.equal(f.posts.filter(p => p.path === "/api/stallionx/sync").length, 1);
    verify();
  });

  test(`${engine}: login and setup recover workspace bootstrap denied by server authorization`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, "en", 1100, "signed_out");
    f.guardWorkspace = true; f.setupFail = true;
    await page.goto(`${origin}/?view=providers`);
    const gate = page.locator("#stxUserGate");
    await gate.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await gate.getByRole("textbox", { name: "6-digit code", exact: true }).fill("123456");
    await gate.getByRole("button", { name: "Sign in", exact: true }).click();
    await gate.getByText("fixture model sync failed", { exact: true }).waitFor();
    assert.ok(f.blockedReads.some(r => r.path === "/api/state"), "server rejects unauthenticated workspace bootstrap");
    await gate.getByRole("button", { name: "Open user center", exact: true }).click();
    await user.getByText(email, { exact: true }).first().waitFor();
    await press("Top up and redeem");
    await user.getByRole("textbox", { name: "Redemption code", exact: true }).fill("RESTORE-SETUP");
    await press("Redeem code");
    await user.getByText(/\$22\.123456/).first().waitFor();
    f.setupFail = false;
    await press("Retry setup");
    await page.waitForFunction(() => load.done && state?.stallionxEnabled && window.stxUser.current.setup === "ready");
    await page.locator('#nav button[data-view="providers"]').click();
    await page.locator('#providers .row.provider[data-id="stallionx"]').waitFor();
    await page.locator("#stxAccount").getByText(email, { exact: true }).waitFor();
    assert.equal(await gate.isVisible(), false);
    assert.equal(f.posts.filter(p => p.path === "/api/stallionx/signin").length, 1);
    verify();
  });

  test(`${engine}: panel setup recovery opens the main user center instead of a missing panel page`, async ctx => {
    const { page, f, verify } = await setup(ctx, engine, "en", 390, "authenticated");
    f.setup = "failed"; f.setupMessage = "fixture panel setup failure";
    await page.goto(`${origin}/?mode=panel`);
    const gate = page.locator("#stxUserGate");
    const opened = page.waitForResponse(r => new URL(r.url()).pathname === "/api/window/main");
    await gate.getByRole("button", { name: "Open user center", exact: true }).click();
    await opened;
    assert.deepEqual(f.windows, [{ view: "stallion-wallet" }]);
    assert.equal(await gate.isVisible(), true, "opening the main window does not unlock the unconfigured panel");
    verify();
  });

  test(`${engine}: an unavailable account module offers a visible reload recovery`, async ctx => {
    const { page, f, verify } = await setup(ctx, engine, "en", 390, "signed_out");
    f.assetFailure = "/stallionx-user.js";
    await page.goto(`${origin}/?view=providers`);
    const gate = page.locator("#stxUserGate");
    await gate.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("stx-user-locked")), true);
    f.assetFailure = "";
    await gate.getByRole("button", { name: "Refresh", exact: true }).click();
    await gate.getByRole("textbox", { name: "Email", exact: true }).waitFor();
    verify();
  });

  test(`${engine}: restoring managed setup requires explicit confirmation in gate and user center`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, "en", 1100, "authenticated");
    f.setup = "failed"; f.setupMessage = "fixture custom provider conflict"; f.setupConflict = true;
    await page.goto(`${origin}/?view=providers`);
    const gate = page.locator("#stxUserGate");
    await gate.getByRole("button", { name: "Restore automatic setup", exact: true }).click();
    await gate.getByRole("button", { name: "Confirm restore", exact: true }).waitFor();
    assert.equal(f.posts.filter(p => p.path.endsWith("/repair")).length, 0);
    await gate.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(f.posts.filter(p => p.path.endsWith("/repair")).length, 0, "cancel preserves the custom provider");
    await gate.getByRole("button", { name: "Open user center", exact: true }).click();
    await user.getByText(f.setupMessage, { exact: true }).waitFor();
    await press("Restore automatic setup");
    assert.equal(f.posts.filter(p => p.path.endsWith("/repair")).length, 0);
    await press("Confirm restore");
    await page.waitForFunction(() => window.stxUser.current.setup === "ready");
    assert.deepEqual(f.posts.filter(p => p.path.endsWith("/repair")), [{ path: "/api/stallionx/repair", body: { confirm: true } }]);
    assert.equal(await gate.isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("stx-account-only")), false);
    verify();
  });
}
