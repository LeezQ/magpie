// Billing and key inventories are real tables: column geometry, accessible
// disclosure, exact server amounts and scrolling local to the table viewport.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { origin, engines, languages, tr, setup, fits } = require("./stallionx-fixture.cjs");

const contexts = [
  { name: "desktop", width: 1440 }, { name: "mobile", width: 390 },
  { name: "sidebar", width: 810, sidebar: true },
  { name: "native125", width: 1152, native: true, zoom: 1.25, height: 680 },
];
const dash = text => assert.match(text.trim(), /^[-\u2013\u2014]$/, "missing or untrusted values display a dash");
const near = (a, b, label) => assert.ok(Math.abs(a - b) <= 1, `${label}: ${a} vs ${b}`);
const logColumns = ["Time", "Request key", "Request scope", "Model", "Request mode", "Input tokens", "Output tokens", "Cost", "Duration", "TTFT", "Status", "Request details"];
const keyColumns = ["Name", "API key", "Status", "Key spending limit (USD)", "Key spending (USD)", "Key created at", "Key last used at", "Key expires at", "Key details"];

function entries() {
  return [
    { created_at: "2026-11-01T01:00:00Z", token_name: "Desktop fixture", team_id: "", model: "fixture-model", is_stream: true,
      prompt_tokens: 1000, cache_read_tokens: 200, cache_creation_tokens: 30, cache_creation_1h_tokens: 10, completion_tokens: 45,
      usage_known: true, cost: "0.000001", request_time: 2500, first_byte_time: 125, status: 1, request_id: "req_personal", input_price: "999.99", output_price: "999.99" },
    { created_at: "2026-11-01T00:59:00Z", token_name: "Team fixture", team_id: "team_public", team_name: "Research team", model: "team-model", is_stream: false,
      prompt_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, usage_known: true,
      cost: "0.123456789012", request_time: 0, first_byte_time: 90, status: 2, request_id: "req_team", error_message: "fixture upstream refusal" },
    { created_at: "2026-11-01T00:58:00Z", token_name: "Historical fixture", team_id: "team_without_name", model: "unknown-usage", is_stream: true,
      prompt_tokens: 900000, cache_read_tokens: 9000, cache_creation_tokens: 800, completion_tokens: 123, usage_known: false,
      cost: "0.000000000009", request_time: null, first_byte_time: 0, status: 3, request_id: "req_unknown" },
    { created_at: "2026-11-01T00:57:00Z", model: "missing-metadata", prompt_tokens: 4, completion_tokens: null, usage_known: true, cost: null, status: 4, request_id: "req_missing" },
  ];
}

function keyEntries() {
  return [
    { id: "token_fixture", name: "Desktop fixture", masked_key: "****1234", status: 1, quota: "0", used_amount: "0.000001",
      period_type: "monthly", period_quota: "20.00", period_used_amount: "1.25", models: ["fixture-model"], allowed_ips: [],
      created_at: "2026-11-01T00:00:00Z", last_used_at: null, expires_at: null },
    { id: "token_limited", name: "Limited fixture", masked_key: "****5678", status: 2, quota: "12.123456789", used_amount: "0",
      created_at: "2026-10-01T00:00:00Z", last_used_at: "2026-10-31T12:00:00Z", expires_at: "2026-12-01T00:00:00Z" },
    { id: "token_missing", name: "Missing metadata", status: 0, quota: null, used_amount: null, created_at: null },
  ];
}

async function tableGeometry(user, kind) {
  return user.locator(`.stxw-${kind}-table`).evaluate(table => {
    const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const scroll = table.closest(`.stxw-${table.classList.contains("stxw-log-table") ? "log" : "key"}-scroll`);
    const rows = [...table.querySelectorAll("tbody > tr")].filter(row => row.classList.contains("stxw-log-row") || row.classList.contains("stxw-key-row"));
    return { columns: [...table.querySelectorAll("thead th")].map(box), rows: rows.map(row => ({ ...box(row), cells: [...row.cells].map(box) })),
      scroll: { ...box(scroll), width: scroll.clientWidth, content: scroll.scrollWidth, overflow: getComputedStyle(scroll).overflowX } };
  });
}

async function checkTable(page, user, kind, columns, count) {
  const table = user.locator(`.stxw-${kind}-table`), rows = table.locator(`.stxw-${kind}-row`);
  await rows.first().waitFor();
  assert.equal(await rows.count(), count);
  assert.deepEqual((await table.locator("thead th").allTextContents()).map(text => text.trim()), await Promise.all(columns.map(key => tr(page, key))), "all table headers retain their translated meaning");
  assert.equal(await table.locator("thead th[scope=col]").count(), columns.length);
  assert.equal(await rows.locator('button[aria-expanded="false"]').count(), count, "every row has one native collapsed disclosure button");
  assert.equal(await table.locator(`.stxw-${kind}-detail:visible`).count(), 0);
  const geometry = await tableGeometry(user, kind);
  assert.ok(["auto", "scroll"].includes(geometry.scroll.overflow), "horizontal scroll belongs to a dedicated table viewport");
  for (const row of geometry.rows) {
    assert.equal(row.cells.length, columns.length);
    for (const [index, cell] of row.cells.entries()) {
      near(cell.left, geometry.columns[index].left, `column ${index} starts under its header`);
      near(cell.right, geometry.columns[index].right, `column ${index} ends under its header`);
      near(cell.top, row.top, "row cells have one top edge");
      near(cell.bottom, row.bottom, "row cells have one bottom edge");
    }
    assert.ok(row.height <= 110, `table rows remain compact while long public team IDs wrap: ${row.height}px`);
  }
  await fits(page, user);
  return { table, rows, geometry };
}

async function expandRow(page, table, kind) {
  const row = table.locator(`.stxw-${kind}-row`).first(), button = row.getByRole("button"), detail = table.locator(`.stxw-${kind}-detail`).first();
  await row.locator("td").first().click();
  await detail.waitFor();
  assert.equal(await button.getAttribute("aria-expanded"), "true");
  assert.equal(await button.getAttribute("aria-controls"), await detail.getAttribute("id"));
  assert.equal(Number(await detail.locator("td").getAttribute("colspan")), await table.locator("thead th").count());
  const contentWidth = await detail.locator(".stxw-detail-content").evaluate(node => node.getBoundingClientRect().width);
  const scrollWidth = await table.locator("..").evaluate(node => node.clientWidth);
  assert.ok(contentWidth <= scrollWidth + 1, "expanded details stay readable within the local viewport");
  // Native buttons supply Enter and Space semantics without a custom row key
  // handler. The table may scroll locally to bring this trailing action in.
  await button.focus(); await page.keyboard.press("Enter"); await detail.waitFor({ state: "hidden" });
  await page.keyboard.press("Space"); await detail.waitFor();
  assert.equal(await button.getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Space"); await detail.waitFor({ state: "hidden" });
  const scroll = table.locator("..");
  await scroll.evaluate(node => { node.scrollLeft = 0; });
}

for (const engine of engines) for (const lang of languages) for (const viewport of contexts) {
  test(`${engine} ${lang} ${viewport.name}: billing and key table geometry, disclosure and server values`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, lang, viewport.width, "authenticated", "light", viewport);
    if (viewport.sidebar) await page.addInitScript(() => { localStorage.setItem("magpie.navLayout", "side"); localStorage.setItem("magpie.sideWidth", "320"); });
    if (process.env.STX_TABLE_BASELINE) await page.route("**/stallionx-wallet.*", async route => {
      const file = path.basename(new URL(route.request().url()).pathname);
      if (!["stallionx-wallet.js", "stallionx-wallet.css"].includes(file)) return route.fallback();
      return route.fulfill({ body: await fs.readFile(path.join(process.env.STX_TABLE_BASELINE, file)), contentType: file.endsWith(".css") ? "text/css" : "text/javascript" });
    });
    f.logs = entries(); f.keys = keyEntries();
    await page.goto(`${origin}/?view=stallion-wallet`);
    await user.getByText(f.email, { exact: true }).first().waitFor();
    if (viewport.native) assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--zoom").trim()), "1.25");
    await press("Request billing");
    await user.locator(".stxw-log-row, summary").first().waitFor();
    assert.equal(await user.locator(".stxw-log-table").count(), 1, "request billing is a real table, not expandable summary cards");
    const logs = await checkTable(page, user, "log", logColumns, 4);
    const cell = (row, column) => logs.rows.nth(row).locator("td").nth(column);
    assert.equal((await cell(0, 2).textContent()).trim(), await tr(page, "Personal workspace"));
    assert.equal((await cell(1, 2).textContent()).trim(), "Research team");
    assert.equal((await cell(2, 2).textContent()).trim(), "team_without_name");
    dash(await cell(3, 2).textContent());
    assert.equal((await cell(0, 4).textContent()).trim(), await tr(page, "Streaming"));
    assert.equal((await cell(1, 4).textContent()).trim(), await tr(page, "Non-streaming"));
    dash(await cell(3, 4).textContent());
    assert.ok((await cell(0, 5).textContent()).includes("1.23") || (await cell(0, 5).textContent()).replace(/\D/g, "") === "1230", "input sums all three buckets once, excluding the one-hour subset");
    assert.equal((await cell(0, 6).textContent()).trim(), "45");
    assert.equal((await cell(1, 5).textContent()).trim(), "0");
    assert.equal((await cell(1, 6).textContent()).trim(), "0");
    for (const index of [2, 3]) { dash(await cell(index, 5).textContent()); dash(await cell(index, 6).textContent()); }
    for (const [index, item] of f.logs.entries()) if (item.cost != null) assert.equal((await cell(index, 7).textContent()).trim(), "$" + item.cost, "persisted cost is neither rounded nor recomputed from prices");
    dash(await cell(3, 7).textContent());
    for (const index of [1, 2, 3]) dash(await cell(index, 9).textContent());
    assert.match(await cell(0, 9).textContent(), /125|0[.,]125/);
    await expandRow(page, logs.table, "log");
    if (logs.geometry.scroll.content > logs.geometry.scroll.width + 1) {
      const scroll = user.locator(".stxw-log-scroll");
      await scroll.evaluate(node => { node.scrollLeft = node.scrollWidth; });
      assert.ok(await scroll.evaluate(node => node.scrollLeft > 0), "wide columns are reachable by local horizontal scrolling");
      assert.equal(await page.evaluate(() => document.documentElement.scrollLeft), 0);
      await fits(page, user); await scroll.evaluate(node => { node.scrollLeft = 0; });
    }
    await screenshot("logs");
    f.emptyLogs = true; await press("Refresh");
    await user.getByText(await tr(page, "No records for these filters."), { exact: true }).waitFor();
    assert.equal(await user.locator(".stxw-log-row").count(), 0);
    assert.equal(await user.locator(".stxw-log-table thead th").count(), logColumns.length, "empty table retains column context");

    await press("API keys");
    const keys = await checkTable(page, user, "key", keyColumns, 3);
    const keyCell = (row, column) => keys.rows.nth(row).locator("td").nth(column);
    assert.equal((await keyCell(0, 3).textContent()).trim(), await tr(page, "Unlimited"));
    assert.equal((await keyCell(0, 4).textContent()).trim(), "$0.000001");
    assert.equal((await keyCell(1, 3).textContent()).trim(), "$12.123456789");
    assert.equal((await keyCell(1, 4).textContent()).trim(), "$0", "known zero usage is not missing");
    assert.equal((await keyCell(1, 2).textContent()).trim(), await tr(page, "Off"));
    dash(await keyCell(2, 1).textContent()); dash(await keyCell(2, 3).textContent()); dash(await keyCell(2, 4).textContent());
    assert.ok((await keys.rows.first().textContent()).includes("1234"));
    assert.equal(await user.getByText("sk-fixture-only", { exact: true }).count(), 0, "no plaintext provider or account secret reaches the table");
    await expandRow(page, keys.table, "key");
    await screenshot("keys");
    f.emptyKeys = true; await press("Refresh");
    await user.getByText(await tr(page, "No records for these filters."), { exact: true }).waitFor();
    assert.equal(await user.locator(".stxw-key-row").count(), 0);
    assert.equal(await user.locator(".stxw-key-table thead th").count(), keyColumns.length);
    verify();

    async function screenshot(kind) {
      if (!process.env.ARTIFACT_DIR || !["zh", "de"].includes(lang)) return;
      await page.evaluate(async () => { await Promise.all([...document.querySelectorAll("#stxWallet .thumb")].flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {}))); });
      await fs.mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/table-${engine}-${lang}-${viewport.name}-${kind}.png` });
    }
  });
}

for (const engine of engines) {
  test(`${engine}: background account refresh preserves table work and updates balance in place`, async ctx => {
    const { page, f, user, press, verify } = await setup(ctx, engine, "en", 810, "authenticated");
    if (process.env.STX_POLL_NEGATIVE === "1") await page.route("**/stallionx-wallet.js", async route => {
      const source = await fs.readFile(path.resolve(__dirname, "../assets/stallionx-wallet.js"), "utf8");
      const start = source.lastIndexOf("    if (keepView) {"), end = source.indexOf("    } else draw();", start);
      assert.ok(start >= 0 && end > start, "negative control locates the subscriber preservation branch");
      await route.fulfill({ contentType: "text/javascript", body: source.slice(0, start) + "    draw();" + source.slice(end + "    } else draw();".length) });
    });
    await page.goto(`${origin}/?view=stallion-wallet`);
    await user.getByText(f.email, { exact: true }).first().waitFor();
    for (const [kind, tab] of [["log", "Request billing"], ["key", "API keys"]]) {
      await press(tab);
      const row = user.locator(`.stxw-${kind}-row`).first(), detail = user.locator(`.stxw-${kind}-detail`).first();
      await row.waitFor(); await row.locator("td").first().click(); await detail.waitFor();
      const focus = kind === "log" ? user.getByRole("searchbox", { name: "Exact model name" }) : row.getByRole("button");
      if (kind === "log") {
        await focus.fill("draft-not-applied");
        await user.locator('input[type="date"]').nth(0).fill("2026-10-07");
        await user.locator('input[type="date"]').nth(1).fill("2026-10-08");
      }
      await focus.focus();
      const scroll = user.locator(`.stxw-${kind}-scroll`);
      const before = await scroll.evaluate(node => { node.scrollLeft = 200; return node.scrollLeft; });
      assert.ok(before > 0, "the table has an established horizontal position");
      f.balance = kind === "log" ? "99.123456" : "101.000001";
      const reads = f.reads.length;
      await page.evaluate(() => window.stxUser.refresh());
      if (kind === "log") {
        assert.equal(await focus.inputValue(), "draft-not-applied", "account polling preserves the model draft");
        assert.deepEqual(await user.locator('input[type="date"]').evaluateAll(nodes => nodes.map(node => node.value)), ["2026-10-07", "2026-10-08"], "account polling preserves unapplied dates");
      }
      assert.equal(await detail.isVisible(), true, "account polling leaves the disclosure open");
      assert.equal(await row.getByRole("button").getAttribute("aria-expanded"), "true");
      assert.equal(await scroll.evaluate(node => node.scrollLeft), before, "account polling does not reset table scroll");
      assert.equal(await focus.evaluate(node => node === document.activeElement), true, "account polling preserves keyboard focus");
      await user.locator(".stxw-summary strong").getByText(new RegExp(f.balance.replace(".", "\\."))).waitFor();
      assert.equal(f.reads.length, reads, "account polling does not trigger unsolicited table refetch");
      assert.deepEqual(f.posts, [], "account polling never submits the filter draft or mutates an account");
    }
    verify();
  });
}
