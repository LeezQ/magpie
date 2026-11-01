// Account surfaces reuse the app's actual controls, not a parallel visual kit.
// Compare rendered original Settings/Providers components in both color schemes.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { test } = require("node:test");
const { origin, email, engines, tr, setup, fits, reach } = require("./stallionx-fixture.cjs");

const font = ["fontFamily", "fontSize", "fontWeight", "lineHeight"];
const edge = ["borderTopWidth", "borderTopStyle", "borderTopColor", "borderTopLeftRadius"];
const paint = ["color", "backgroundColor", "backgroundImage", "boxShadow"];
const padding = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
const control = [...font, ...edge, ...paint, ...padding, "height"];
const surface = [...edge, "backgroundColor", "backgroundImage"];

async function style(locator, keys) {
  await locator.waitFor({ state: "visible" });
  return locator.evaluate((node, keys) => {
    const s = getComputedStyle(node);
    return Object.fromEntries(keys.map(key => [key, s[key]]));
  }, keys);
}
function same(actual, expected, label, keys = Object.keys(expected)) {
  for (const key of keys) assert.equal(actual[key], expected[key], `${label}: ${key} follows the original component`);
}
async function focusedStyle(locator) {
  await locator.focus();
  await locator.evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished)); });
  return style(locator, ["borderTopColor", "boxShadow", "outlineStyle", "outlineWidth", "outlineOffset"]);
}

for (const engine of engines) for (const theme of ["light", "dark"]) for (const width of [1100, 390]) {
  test(`${engine} ${theme} ${width}: user surfaces match original Settings and Providers controls`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, "zh", width, "authenticated", theme);
    const screenshot = async name => {
      if (!process.env.ARTIFACT_DIR) return;
      // Original segmented controls glide for 280ms, even on reduced-motion
      // fixtures. Capture only after the real highlight reaches its option.
      await page.waitForFunction(() => [...document.querySelectorAll(".segs")].filter(box => box.offsetWidth && box.offsetHeight).every(box => {
        const on = box.querySelector(".opt.on"), thumb = box.querySelector(".thumb");
        if (!on || !thumb) return true;
        const a = on.getBoundingClientRect(), b = thumb.getBoundingClientRect();
        return Math.abs(a.x - b.x) < 1 && Math.abs(a.width - b.width) < 1;
      }));
      await page.evaluate(async () => {
        const roots = [...document.querySelectorAll("#stxUserGate, #stxWallet")];
        await Promise.all(roots.flatMap(root => root.getAnimations({ subtree: true })).map(animation => animation.finished.catch(() => {})));
      });
      await fs.mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/style-${engine}-${theme}-${width}-${name}.png` });
    };
    await page.goto(`${origin}/?view=settings`);
    const settingsCard = page.locator('#setPage-general .list').first();
    await page.locator("#themeSegs .segs").waitFor();
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    const baseline = {
      card: await style(settingsCard, surface),
      row: await style(settingsCard.locator(".row.pref").first(), [...font, ...padding]),
      segments: await style(page.locator("#themeSegs .segs"), [...surface, ...padding]),
      selected: await style(page.locator("#themeSegs .opt.on"), [...font, ...padding, "color", "borderTopLeftRadius", "minHeight"]),
      option: await style(page.locator("#themeSegs .opt:not(.on)").first(), [...font, ...padding, "color", "borderTopLeftRadius", "minHeight"]),
      background: await page.locator("body").evaluate(node => getComputedStyle(node).backgroundColor),
    };
    await screenshot("settings");
    await page.evaluate(() => show("providers"));
    const provider = page.locator('#providers .row.provider[data-id="stallionx"]');
    await provider.waitFor();
    await screenshot("providers");
    await reach(page, provider); await provider.click();
    const editor = page.locator("#modal .editor"); await editor.waitFor();
    const originalInput = editor.locator('input[type="text"]:visible').first();
    await page.mouse.move(0, 0);
    baseline.input = await style(originalInput, control);
    baseline.action = await style(editor.locator("button.text.action:visible").first(), control);
    baseline.primary = await style(editor.locator("button.text.primary:visible").first(), ["backgroundColor", "color", "fontWeight"]);
    baseline.focus = await focusedStyle(originalInput);
    await page.evaluate(() => cancelEdit()); await page.locator("#modal").waitFor({ state: "hidden" });

    f.state = "signed_out";
    await page.reload();
    const gate = page.locator("#stxUserGate"), address = gate.getByRole("textbox", { name: await tr(page, "Email"), exact: true });
    await address.waitFor(); await page.mouse.move(0, 0);
    assert.equal(await gate.locator('.stxu-login > .stxu-copy').count(), 0, "normal login contains no explanatory prose");
    // Optional negative control used in acceptance: reproduce the old custom
    // input skin only in this isolated fixture, never in checked-in assets.
    if (process.env.STX_STYLE_NEGATIVE === "1") await page.addStyleTag({ content: ".stxu-field input.words { background: red; }" });
    // Login has deliberately larger geometry than dense workspace settings.
    // Shared palette, typography family and focus feedback still match them.
    same(await style(address, ["fontFamily", ...paint]), baseline.input, "login input", ["fontFamily", ...paint]);
    same(await style(gate.locator("#stxSendCode"), ["fontFamily", ...paint]), baseline.action, "send-code action", ["fontFamily", ...paint]);
    const geometry = await gate.evaluate(root => {
      const panel = root.querySelector('.stxu-login').getBoundingClientRect();
      const form = root.querySelector('form').getBoundingClientRect();
      const submit = root.querySelector('button[type="submit"]').getBoundingClientRect();
      const input = root.querySelector('input').getBoundingClientRect();
      return { panel: panel.width, form: form.width, submit: submit.width, height: submit.height, input: input.height };
    });
    assert.ok(geometry.panel <= 441, "login remains bounded on desktop");
    assert.ok(Math.abs(geometry.form - geometry.submit) < 1, "primary action spans the form");
    assert.ok(geometry.height >= 44 && geometry.input >= 42, "comfortable login targets");
    const signIn = gate.getByRole("button", { name: await tr(page, "Sign in"), exact: true });
    same(await style(signIn, ["backgroundColor", "color", "fontWeight"]), baseline.primary, "primary login action");
    same(await style(gate.locator(".stxu-login"), ["backgroundColor"]), baseline.card, "login surface", ["backgroundColor"]);
    assert.equal(await gate.evaluate(node => getComputedStyle(node).backgroundImage), "none", "login uses the original plain application background");
    assert.equal(await gate.evaluate(node => getComputedStyle(node).backgroundColor), baseline.background);
    same(await focusedStyle(address), baseline.focus, "focused login input");
    await address.blur(); await fits(page, gate); await screenshot("gate");
    await address.fill(email);
    await gate.getByRole("textbox", { name: await tr(page, "6-digit code"), exact: true }).fill("123456");
    await signIn.click(); await gate.waitFor({ state: "hidden" });
    await user.getByText(email, { exact: true }).first().waitFor();
    await page.mouse.move(0, 0);
    same(await style(user.locator(".stxw-tabs.segs"), [...surface, ...padding]), baseline.segments, "user-center tabs");
    same(await style(user.locator(".stxw-tabs .opt.on"), [...font, ...padding, "color", "borderTopLeftRadius", "minHeight"]), baseline.selected, "selected account tab");
    same(await style(user.locator(".stxw-tabs .opt:not(.on)").first(), [...font, ...padding, "color", "borderTopLeftRadius", "minHeight"]), baseline.option, "unselected account tab");
    same(await style(user.locator(".list").first(), surface), baseline.card, "account overview card");
    same(await style(user.locator(".stxu-profile > .row.pref").first(), [...font, ...padding]), baseline.row, "account overview row");
    await fits(page, user); await screenshot("overview");

    await press("Top up and redeem"); await page.mouse.move(0, 0);
    const amount = user.getByRole("textbox", { name: await tr(page, "Amount (USD)"), exact: true });
    same(await style(amount, control), baseline.input, "payment amount input");
    same(await style(user.getByRole("textbox", { name: await tr(page, "Redemption code"), exact: true }), control), baseline.input, "redemption input");
    const pay = user.getByRole("button", { name: await tr(page, "Create payment order"), exact: true });
    same(await style(pay, control), baseline.action, "payment action geometry", [...edge, ...padding, "height", "fontFamily", "fontSize", "lineHeight"]);
    same(await style(pay, ["backgroundColor", "color", "fontWeight"]), baseline.primary, "primary payment action");
    same(await style(user.locator(".list").first(), surface), baseline.card, "top-up card");
    same(await focusedStyle(amount), baseline.focus, "focused payment input");
    await amount.blur(); await fits(page, user); await screenshot("topup");

    await press("Request billing"); await page.mouse.move(0, 0);
    await user.locator(".stxw-log-row").waitFor();
    same(await style(user.getByRole("searchbox", { name: await tr(page, "Exact model name") }), control), baseline.input, "billing model filter");
    same(await style(user.locator(".list").first(), surface), baseline.card, "request billing card");
    await fits(page, user); await screenshot("logs");
    verify();
  });
}
