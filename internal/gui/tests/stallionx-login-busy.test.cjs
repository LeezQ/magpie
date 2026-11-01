// Hold each request explicitly: fast fixture replies would hide a shared-busy
// label bug. No mail is sent and no real account/session is accessed.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { origin, engines, languages, setup, tr } = require(`${__dirname}/stallionx-fixture.cjs`);

for (const engine of engines) for (const lang of languages) {
  test(`${engine} ${lang}: loading belongs only to the active login action`, async ctx => {
    const { page, verify } = await setup(ctx, engine, lang, 390, 'signed_out');
    let releaseCode, releaseLogin;
    const heldCode = new Promise(resolve => { releaseCode = resolve; });
    const heldLogin = new Promise(resolve => { releaseLogin = resolve; });
    ctx.after(() => { releaseCode(); releaseLogin(); });
    await page.route('**/api/stallionx/code', async route => { await heldCode; await route.fulfill({ json: {} }); });
    await page.route('**/api/stallionx/signin', async route => {
      await heldLogin;
      await route.fulfill({ status: 400, json: { error: 'fixture login refusal' } });
    });
    await page.goto(origin);
    const gate = page.locator('#stxUserGate');
    await gate.getByRole('textbox', { name: await tr(page, 'Email'), exact: true }).fill('reader@example.com');
    await gate.getByRole('button', { name: await tr(page, 'Send code'), exact: true }).click();
    const submit = gate.locator('button[type="submit"]');
    await gate.getByRole('button', { name: await tr(page, 'Sending…'), exact: true }).waitFor();
    assert.equal(await submit.textContent(), await tr(page, 'Sign in'));
    assert.equal(await submit.getAttribute('aria-busy'), 'false');
    assert.equal(await submit.isDisabled(), true, 'overlapping mutations remain blocked');
    releaseCode();
    await page.waitForFunction(() => !document.querySelector('#stxUserGate button[type="submit"]').disabled);
    await gate.getByRole('textbox', { name: await tr(page, '6-digit code'), exact: true }).fill('123456');
    await submit.click();
    await gate.getByRole('button', { name: await tr(page, 'Signing in…'), exact: true }).waitFor();
    assert.equal(await submit.getAttribute('aria-busy'), 'true');
    assert.equal(await gate.locator('#stxSendCode').getAttribute('aria-busy'), 'false');
    releaseLogin();
    await gate.getByRole('alert').filter({ hasText: 'fixture login refusal' }).waitFor();
    assert.equal(await submit.textContent(), await tr(page, 'Sign in'));
    assert.equal(await submit.isDisabled(), false);
    verify();
  });
}
