// Provider integration remains a model/key editor, not a second user login.
// The dedicated shell only hides other product capabilities; it writes none.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { origin, email, engines, languages, tr, setup, fits, reach } = require("./stallionx-fixture.cjs");

for (const engine of engines) for (const lang of languages) for (const width of [1100, 390]) {
  test(`${engine} ${lang} ${width}: provider status links to user center and preserves model/key editing`, async ctx => {
    const { page, f, user, verify } = await setup(ctx, engine, lang, width, "authenticated");
    await page.goto(`${origin}/?view=providers`);
    await page.waitForFunction(() => load.done && state?.stallionxEnabled);
    const card = page.locator("#stxAccount .stx-account"); await card.waitFor();
    await card.getByText(email, { exact: false }).first().waitFor();
    assert.equal(await card.locator("input").count(), 0, "provider card never hosts login fields");
    assert.equal(await card.getByRole("button", { name: await tr(page, "Sign out"), exact: true }).count(), 0, "only user center owns logout");
    assert.equal(await page.locator('#providers [data-id="other-service"]').count(), 0);
    assert.equal(await page.locator("#addProvider").isVisible(), false);
    assert.equal(await page.locator("#modal").isVisible(), false);
    assert.deepEqual(await page.locator("#nav button[data-view]:visible").evaluateAll(nodes => nodes.map(n => n.dataset.view)), ["agents", "sessions", "library", "providers", "routing", "gateway", "usage", "masking", "stallion-wallet"]);
    for (const destination of ["plugins", "community-test"]) {
      await page.evaluate(v => show(v), destination);
      assert.equal(await page.locator("#view-providers").isVisible(), true, `${destination} stays hidden`);
    }
    await page.evaluate(async () => { await show("settings"); setSetTab("plugins", true); });
    assert.equal(await page.locator("#setPage-general").isVisible(), true);
    assert.deepEqual(await page.locator("#setTabs [data-set]").evaluateAll(nodes => nodes.filter(n => !n.hidden).map(n => n.dataset.set)), ["general", "usage", "network", "models", "privacy", "about"]);
    await page.evaluate(() => { $("#setQ").value = "plugin"; searchSettings("plugin"); });
    assert.equal(await page.locator("#setPage-plugins").isVisible(), false);
    await page.evaluate(() => { searchSettings(""); return show("providers"); });
    await fits(page, card);
    const providerRow = page.locator('#providers .row.provider[data-id="stallionx"]');
    await reach(page, providerRow); await providerRow.click();
    const editor = page.locator("#modal .editor"); await editor.waitFor();
    assert.ok((await editor.textContent()).includes("Fixture model"), "model list stays in the existing editor");
    assert.equal(await editor.locator("input").evaluateAll(nodes => nodes.some(n => n.value === "sk-fixture-only")), false, "key is masked by default");
    const show = editor.getByRole("button", { name: await tr(page, "Show"), exact: true });
    await reach(page, show); await show.click();
    await page.waitForFunction(() => [...document.querySelectorAll("#modal .editor input")].some(n => n.value === "sk-fixture-only"));
    await page.evaluate(() => renderProviders(true)); await editor.waitFor();
    await page.evaluate(() => cancelEdit()); await page.locator("#modal").waitFor({ state: "hidden" });
    const center = card.getByRole("button", { name: await tr(page, "Open user center"), exact: true });
    await reach(page, center); await center.click();
    await user.getByRole("heading", { level: 2 }).waitFor();
    assert.equal(await page.locator("#view-stallion-wallet").isVisible(), true);
    assert.equal(await page.locator("#stxUserGate").isVisible(), false);
    assert.deepEqual(f.posts, [], "navigation and visibility never mutate saved settings or credentials");
    verify();
  });
}
