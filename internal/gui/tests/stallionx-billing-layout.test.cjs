// Geometry, not only shared control skins: filters are aligned groups and the
// pagination actions stay together at narrow, ordinary and ultrawide sizes.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { origin, engines, languages, tr, setup, fits } = require("./stallionx-fixture.cjs");

const near = (a, b, message) => assert.ok(Math.abs(a - b) <= 1, `${message}: ${a} vs ${b}`);

async function geometry(user) {
  return user.evaluate(root => {
    const rect = node => {
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const input = node => {
      const label = node.closest("label"), span = label?.querySelector("span");
      return { ...rect(node), label: label ? rect(label) : null, labelText: span?.textContent || "",
        labelRect: span ? rect(span) : null, labelStyle: span ? { font: getComputedStyle(span).font, color: getComputedStyle(span).color } : null };
    };
    const form = root.querySelector('input[type="search"]').closest("form"), inputs = form.querySelectorAll("input");
    const states = form.querySelector(".stxw-statuses"), apply = [...form.querySelectorAll("button")].find(n => !n.closest(".segs"));
    const paging = root.querySelector(".stxw-pagination"), buttons = paging.querySelectorAll("button");
    const info = [...paging.querySelectorAll("span")].find(n => !n.closest("button"));
    return { root: rect(root), form: rect(form), fields: [...inputs].map(input), states: rect(states), apply: rect(apply),
      options: [...states.querySelectorAll("button")].map(node => ({ ...rect(node), clipped: node.scrollWidth - node.clientWidth })),
      paging: rect(paging), previous: rect(buttons[0]), next: rect(buttons[1]), info: rect(info),
      overflow: form.scrollWidth - form.clientWidth };
  });
}

function aligned(g, width) {
  const [model, from, through] = g.fields;
  assert.equal(g.fields.length, 3, "model and date inputs are one filter group");
  if (width >= 1100) {
    near(model.bottom, from.bottom, "model and start date share an input baseline");
    near(from.bottom, through.bottom, "dates share an input baseline");
    for (const field of [from, through]) assert.ok(field.width <= 181, `date control stays compact: ${field.width}px`);
    assert.ok(model.width <= 421, `model filter stays compact: ${model.width}px`);
  }
  for (const field of g.fields) {
    assert.ok(field.labelRect && field.labelText.trim(), "every filter has a separate visible label");
    assert.ok(field.labelRect.bottom <= field.top - 2, "labels sit above controls without overlap");
    assert.ok(field.top - field.labelRect.bottom <= 9, "label and control remain one compact field");
    assert.deepEqual(field.labelStyle, model.labelStyle, "filter labels have the same type and color");
    assert.ok(field.left >= g.form.left - 1 && field.right <= g.form.right + 1, "field stays inside the filter form");
  }
  if (width >= 1100) {
    near(model.labelRect.bottom, from.labelRect.bottom, "model/start labels align");
    near(from.labelRect.bottom, through.labelRect.bottom, "date labels align");
  }
  const fieldsBottom = Math.max(...g.fields.map(field => field.bottom));
  assert.ok(g.states.top >= fieldsBottom + 4, "status choices have their own row below the fields");
  assert.ok(g.apply.top >= fieldsBottom + 4, "Apply belongs to the status/action row");
  if (width >= 1100) {
    near((g.states.top + g.states.bottom) / 2, (g.apply.top + g.apply.bottom) / 2, "desktop status and Apply controls align vertically");
    assert.ok(g.apply.left >= g.states.right + 4, "Apply does not overlap the status choices");
    near(g.apply.right, through.right, "Apply aligns with the right edge of the date group");
    near(g.states.left, model.left, "status choices align with the model field");
  }
  for (const control of [g.states, g.apply, ...g.options]) {
    assert.ok(control.left >= g.form.left - 1 && control.right <= g.form.right + 1, "status/action row stays within the form");
    if (control.clipped != null) assert.ok(control.clipped <= 1, "translated status is not clipped");
  }
  assert.ok(g.apply.top >= g.states.bottom - 1 || g.apply.left >= g.states.right + 4, "wrapped Apply never overlaps status controls");
  assert.ok(g.overflow <= 1, `filter form does not scroll horizontally: ${g.overflow}px`);
  near(g.previous.top, g.next.top, "pagination buttons share a row");
  assert.ok(g.next.left - g.previous.right >= 3 && g.next.left - g.previous.right <= 13, "Previous and Next form one tight cluster");
  near(g.next.right, g.paging.right, "pagination actions align at the right edge");
  near(g.info.left, g.paging.left, "page information starts at the left edge");
  assert.ok(g.info.bottom <= g.previous.top + 1 || g.info.right <= g.previous.left - 3, "page info never overlaps the button cluster");
}

for (const engine of engines) for (const lang of languages) for (const width of [1100, 1440, 2048, 390]) {
  test(`${engine} ${lang} ${width}: billing filter and pagination geometry in empty and populated states`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, lang, width, "authenticated");
    // Acceptance can serve a preserved pre-fix pair of assets without ever
    // reverting or editing production files in a shared working tree.
    if (process.env.STX_LAYOUT_BASELINE) await page.route("**/stallionx-wallet.*", async route => {
      const file = path.basename(new URL(route.request().url()).pathname);
      if (!["stallionx-wallet.js", "stallionx-wallet.css"].includes(file)) return route.fallback();
      return route.fulfill({ body: await fs.readFile(path.join(process.env.STX_LAYOUT_BASELINE, file)), contentType: file.endsWith(".css") ? "text/css" : "text/javascript" });
    });
    await page.goto(`${origin}/?view=stallion-wallet`);
    await user.getByText(f.email, { exact: true }).first().waitFor();
    await press("Request billing");
    for (const empty of [false, true]) {
      if (empty) { f.emptyLogs = true; await press("Refresh"); }
      if (empty) await user.getByText(await tr(page, "No records for these filters."), { exact: true }).waitFor();
      else await user.locator(".stxw-log-row").waitFor();
      const g = await geometry(user);
      aligned(g, width); await fits(page, user);
      const next = user.getByRole("button", { name: await tr(page, "Next billing page"), exact: true });
      assert.equal(await next.count(), 1, "pagination uses a page-specific next label, not the onboarding Next step");
      assert.equal(await next.isDisabled(), empty);
      if (process.env.ARTIFACT_DIR && ["zh", "de"].includes(lang)) {
        await page.waitForFunction(() => [...document.querySelectorAll("#stxWallet .segs")].every(box => {
          const on = box.querySelector(".on"), thumb = box.querySelector(".thumb");
          if (!on || !thumb) return false;
          const a = on.getBoundingClientRect(), b = thumb.getBoundingClientRect();
          return Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1;
        }));
        await fs.mkdir(process.env.ARTIFACT_DIR, { recursive: true });
        await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/billing-${engine}-${lang}-${width}-${empty ? "empty" : "populated"}.png` });
      }
    }
    verify();
  });
}

for (const engine of engines) {
  test(`${engine}: billing filters adapt to a real narrow sidebar content area`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, "de", 810, "authenticated");
    await page.addInitScript(() => {
      localStorage.setItem("magpie.navLayout", "side");
      localStorage.setItem("magpie.sideWidth", "320");
    });
    await page.goto(`${origin}/?view=stallion-wallet`);
    await user.getByText(f.email, { exact: true }).first().waitFor();
    await press("Request billing"); await user.locator(".stxw-log-row").waitFor();
    assert.equal(await page.locator("body").evaluate(node => node.classList.contains("side-nav")), true, "actual sidebar layout is active");
    const g = await geometry(user);
    assert.ok(g.form.width < 520 && g.form.width > 400, `sidebar constrains content, not the viewport: ${g.form.width}px`);
    aligned(g, 390); await fits(page, user);
    assert.ok(g.fields[0].bottom < g.fields[1].top, "container query places model above dates independently of viewport fallback");
    near(g.fields[1].bottom, g.fields[2].bottom, "two dates share the narrower content row");
    verify();
  });
}
