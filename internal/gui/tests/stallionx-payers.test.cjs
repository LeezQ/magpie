// Payers (stallionx-payers.js): the wallets a StallionX account can pay
// from. A member whose personal wallet can't set up turns a team's wallet on
// from the setup gate, and a team member is asked once which wallet is the
// default. Both engines, both widths, every language.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { origin, engines, languages, tr, setup, fits, reach } = require("./stallionx-fixture.cjs");

const alpha = () => ({ id: "team_alpha", name: "Alpha", role: 3, wallet: { quota: "50", used_amount: "10", remaining_quota: "40" } });
// German keeps the billing table's short word: the same key fills its narrow
// scope column (stallionx-billing-table.test.cjs holds the row height)
const personalName = { en: "Personal workspace", zh: "个人空间", "zh-TW": "個人空間", ja: "個人スペース", de: "Persönlich" };

for (const engine of engines) for (const lang of languages) for (const width of [1100, 390]) {
  test(`${engine} ${lang} ${width}: the setup gate turns a team's wallet on`, async ctx => {
    const { page, f, verify } = await setup(ctx, engine, lang, width, "authenticated");
    f.setup = "failed"; f.setupMessage = "fixture model sync failed"; f.teams = [alpha()];
    await page.goto(`${origin}/?view=providers`);
    const row = page.locator('#stxUserGate .stxu-payers .stxp-row[data-payer="team_alpha"]');
    await row.waitFor();
    assert.ok((await page.locator('#stxUserGate .stxp-row[data-payer="personal"] .stxp-name').textContent()).startsWith(personalName[lang]));
    assert.ok((await row.textContent()).includes("$40"), "a member sees their own quota left");
    await fits(page, page.locator("#stxUserGate .stxu-login"));
    // the gate's other payer, the personal wallet, can't be made usable here
    const use = row.getByRole("button", { name: await tr(page, "Use on this computer"), exact: true });
    await reach(page, use); await use.click();
    // what turning it on makes, before anything is asked of the service
    const confirm = page.locator("dialog.action-confirm");
    await confirm.waitFor();
    assert.equal(f.posts.filter(x => x.path.startsWith("/api/stallionx/payers/")).length, 0, "nothing set up before the user confirms");
    await confirm.getByRole("button", { name: await tr(page, "Use on this computer"), exact: true }).click();
    await page.locator("#stxUserGate").waitFor({ state: "hidden" });
    assert.deepEqual(f.posts.filter(x => x.path.startsWith("/api/stallionx/payers/")), [{ path: "/api/stallionx/payers/enable", body: { id: "team_alpha" } }]);
    // the team's own provider shows beside the personal one, nothing else
    await page.locator('#providers .row.provider[data-id="stallionx-team-alpha"]').waitFor();
    assert.equal(await page.locator('#providers [data-id="other-service"]').count(), 0);
    verify();
  });

  test(`${engine} ${lang} ${width}: a team member is asked once which wallet is the default`, async ctx => {
    const { page, f, verify } = await setup(ctx, engine, lang, width, "authenticated");
    f.teams = [alpha()]; f.payerAsk = true;
    await page.goto(`${origin}/?view=providers`);
    const ask = page.locator("dialog.stxp-ask");
    await ask.waitFor();
    await fits(page, ask);
    // centred in the window like the app's other confirmations: app.css's
    // `* { margin: 0 }` leaves a bare <dialog> in the top-left corner, under
    // the Mac's traffic lights, which fits() alone doesn't see
    const gaps = () => ask.evaluate(d => {
      const r = d.getBoundingClientRect(), v = document.documentElement;
      return { left: r.left, right: v.clientWidth - r.right, top: r.top, bottom: v.clientHeight - r.bottom };
    });
    const g = await gaps();
    assert.ok(g.left >= 8 && Math.abs(g.left - g.right) <= 2, `centred across: ${JSON.stringify(g)}`);
    assert.ok(g.top >= 8 && Math.abs(g.top - g.bottom) <= 2, `centred down: ${JSON.stringify(g)}`);
    // veiled like .action-confirm, not the engine's faint default backdrop
    assert.equal(await ask.evaluate(d => getComputedStyle(d, "::backdrop").backgroundColor), "rgba(0, 0, 0, 0.32)");
    // the Mac app's window draws its traffic lights in the top 50px; the
    // classes this adds are taken off again for the rest of the test
    const added = await page.evaluate(() => ["window", "mac"].filter(c => !document.body.classList.contains(c) && (document.body.classList.add(c), true)));
    const m = await gaps();
    assert.ok(m.top >= 50, `below the Mac's traffic lights: ${JSON.stringify(m)}`);
    await page.evaluate(cs => document.body.classList.remove(...cs), added);
    assert.equal(await ask.locator(".stxp-choice").count(), 2, "personal and the team");
    assert.equal(await ask.locator('.stxp-choice[data-payer="personal"] .stxp-name').textContent(), personalName[lang]);
    await ask.locator('.stxp-choice[data-payer="team_alpha"]').click();
    await ask.waitFor({ state: "detached" });
    assert.deepEqual(f.posts.filter(x => x.path.startsWith("/api/stallionx/payers/")), [{ path: "/api/stallionx/payers/default", body: { id: "team_alpha" } }]);
    // the account card shows it as the default from then on
    const card = page.locator('#stxAccount .stx-payers .stxp-row[data-payer="team_alpha"]');
    await card.waitFor();
    await page.waitForFunction(() => document.querySelector('#stxAccount .stxp-row[data-payer="team_alpha"].default'));
    assert.equal(await page.locator('#stxAccount .stxp-row[data-payer="personal"] .stxp-name').textContent(), personalName[lang]);
    // not asked again on the next load
    await page.reload();
    await page.locator("#stxAccount .stx-payers .stxp-row").first().waitFor();
    assert.equal(await page.locator("dialog.stxp-ask").count(), 0);
    verify();
  });
}
