const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setup, engines, origin } = require('./stallionx-fixture.cjs');
const { expect } = require('playwright/test');
const consoleOrigin = 'http://127.0.0.1:49731';
const keyID = 'key_0123456789abcdef0123456789abcdef';

async function consoleSetup(ctx, engine, lang, width, state = 'authenticated', options = {}) {
  const env = await setup(ctx, engine, lang, width, state, 'light', {console:true,...options});
  const { page, context, f } = env;
  const requests = [], unsupported = [];
  const team = { id: 'team_fixture', slug: 'fixture-team', name: 'Fixture Team', role: 3, status: 1, balance: '20.50', used_amount: '1.25', owner_user_id: 'user_fixture', max_members: 10, member_count: 1 };
  const account = { id: 'user_fixture', username: 'Fixture Reader', email: f.email, email_verified: true, balance: '12.123456', used_amount: '1.25', billing_mode: 0, role: 1, status: 1, active_tokens: 1, group_name: 'Standard', created_at: '2026-10-01T00:00:00Z' };
  await context.route(origin + '/api/stallionx/console-session', route => route.fulfill({json:{url:consoleOrigin+'/',capability:'fixture-capability-for-console-only'}}));
  await context.route(consoleOrigin + '/**', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname.replace('/api/stallionx/console', '');
    if (!p.startsWith('/api/')) {
      const file = path.resolve(__dirname, '../assets/stallionx-console', p === '/' ? 'index.html' : '.'+p);
      const contentType = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'}[path.extname(file)] || 'application/octet-stream';
      return route.fulfill({body:await fs.readFile(file),contentType});
    }
    requests.push({method:req.method(),path:p,query:Object.fromEntries(url.searchParams),body:req.postData()});
    assert.equal(req.headers().authorization, 'Bearer fixture-capability-for-console-only');
    assert.equal(req.headers().cookie, undefined);
    const reply = data => route.fulfill({json:{success:true,data}});
    if (p === '/api/user/self') return reply(account);
    if (p === '/api/branding') return reply({name:'StallionX',logo:'',subtitle:'',notice:''});
    if (p === '/api/status') return reply({version:'fixture',system_name:'StallionX'});
    if (p === '/api/team/mine') return reply([team]);
    if (p === '/api/team/resolve/fixture-team' || p === '/api/team/team_fixture') return reply(team);
    if (p === '/api/notification/self/unread') return reply({count:0});
    if (p === '/api/notification/self') return reply({items:[],total:0});
    if (p === '/api/channel/models' || p === '/api/playground/models') return reply({models:['fixture-model']});
    if (p === '/api/channel-group/') return reply({items:[{id:'cgroup_fixture',name:'Standard',status:1,is_default:true,discount_rate:'1'}],total:1,total_pages:1});
    if (p === '/api/user/self/discounts') return reply([]);
    if (p === '/api/pricing/public') return reply([]);
    if (p === '/api/token/' || p === '/api/team/team_fixture/tokens') return reply({items:[{id:keyID,user_id:account.id,team_id:p.includes('/team/')?team.id:'',name:'Fixture API Key',key:'****1234',status:1,quota:'0',used_amount:'0.000001',period_type:'',period_quota:'0',channel_group_ids:['cgroup_fixture'],created_at:'2026-10-01T00:00:00Z'}],total:1});
    if (p === '/api/log/self' || p === '/api/team/team_fixture/logs') return reply({items:[{id:'log_fixture',request_id:'request_fixture',model:'fixture-model',token_name:'Fixture API Key',token_id:keyID,created_at:'2026-11-01T01:00:00Z',status:1,cost:'0.000001',prompt_tokens:12,completion_tokens:3,cache_read_tokens:4,cache_creation_tokens:2,usage_known:true,group_discount_rate:'1',request_time:1200,first_byte_time:120,is_stream:true,billing_type:'token',input_price:'1.25',output_price:'10',request_path:'/v1/chat/completions',client_ip:'127.0.0.1'}],total:1});
    if (p.endsWith('/logs/summary') || p === '/api/log/self/summary') return reply({total_requests:1,total_cost:'0.000001'});
    if (p === '/api/payment/config') return reply({enabled:true,min_amount:'1',max_amount:'1000',preset_amounts:['10','25','50'],currency:'USD'});
    if (p === '/api/payment/orders' || p === '/api/balance-log/self') return reply({items:[],total:0});
    if (p === '/api/team/team_fixture/members') return reply({items:[{user_id:account.id,username:account.username,email:account.email,role:3,status:1}],total:1});
    if (p === '/api/team/team_fixture/usage') return reply({summary:{},daily:[],models:[],members:[]});
    if (p === '/api/team/team_fixture/balance-logs' || p === '/api/team/team_fixture/activity' || p === '/api/team/team_fixture/invitations') return reply({items:[],total:0});
    if (p === '/api/subscription/current') return reply([]);
    if (p === '/api/plan/available') return reply([]);
    unsupported.push(p);
    return route.fulfill({status:501,json:{success:false,message:'Unmocked console API: '+p}});
  });
  return {...env,requests,unsupported};
}

for (const engine of engines) for (const lang of ['en','zh']) for (const layout of ['side','top']) {
  test(`${engine} ${lang} ${layout}: refresh never flashes the legacy account navigation`, async ctx => {
    const {page,context,verify}=await consoleSetup(ctx,engine,lang,1280);
    await page.addInitScript(layout=>localStorage.setItem('magpie.navLayout',layout),layout);
    let release;
    const held=new Promise(resolve=>{release=resolve;});
    ctx.after(()=>release());
    await context.route(origin+'/api/stallionx/console-session',async route=>{
      await held;
      return route.fulfill({json:{url:consoleOrigin+'/',capability:'fixture-capability-for-console-only'}});
    });
    await page.goto(origin+'/?view=stallion-wallet&account=%2Fpersonal%2Flog');
    await expect(page.locator('#stxUserGate')).toBeHidden();
    assert.equal(await page.locator('#stxWalletEntry').isVisible(),false,'legacy User center never appears while awaiting the console');
    assert.equal(await page.locator('#nav .nav-gl').filter({hasText:lang==='zh'?'扩展':'Extend'}).isVisible(),false,'legacy Extend group never appears');
    await expect(page.locator('#stxcNavPending')).toBeVisible();
    assert.equal(await page.locator('#crumb').isVisible(),false,'no temporary legacy breadcrumb');
    release();
    await page.locator('#nav [data-stx-route="/personal/log"]').waitFor();
    await expect(page.locator('#stxcNavPending')).toBeHidden();
    await expect(page.locator('#nav [aria-current="page"]')).toHaveAttribute('data-stx-route','/personal/log');
    await page.reload();
    await page.locator('#nav [data-stx-route="/profile"]').waitFor();
    assert.equal(await page.locator('#stxWalletEntry').isVisible(),false);
    verify();
  });
}

for (const engine of engines) {
  test(`${engine}: console navigation startup failure offers retry without legacy menus`, async ctx=>{
    const {page,context,verify}=await consoleSetup(ctx,engine,'en',1280);
    let fail=true;
    await context.route(origin+'/api/stallionx/console-session',route=>fail
      ? route.fulfill({status:503,json:{error:'Fixture service unavailable'}})
      : route.fulfill({json:{url:consoleOrigin+'/',capability:'fixture-capability-for-console-only'}}));
    await page.goto(origin+'/?view=stallion-wallet');
    await expect(page.locator('#stxcNavPending button')).toBeEnabled();
    assert.equal(await page.locator('#stxWalletEntry').isVisible(),false);
    fail=false;
    await page.locator('#stxcNavPending button').click();
    await page.locator('#nav [data-stx-route="/profile"]').waitFor();
    await expect(page.locator('#stxcNavPending')).toBeHidden();
    verify();
  });
}

async function headerFits(page) {
  // ResizeObserver and the account adapter settle on the next animation frame.
  await expect(async () => {
    const bounds = await page.evaluate(() => {
      const top = document.querySelector('.top'), nav = document.querySelector('#nav');
      const r = e => { const b=e.getBoundingClientRect(); return {left:b.left,right:b.right,top:b.top,bottom:b.bottom}; };
      const lead = [...top.querySelectorAll(':scope > .brand, :scope > #sideToggle')].filter(e=>e.getClientRects().length);
      return {top:r(top),nav:r(nav),actions:r(top.querySelector('.actions')),lead:lead.map(r),
        groups:[...nav.querySelectorAll('.nav-gl, .stxc-nav-group')].filter(e=>e.getClientRects().length).map(e=>e.textContent),
        buttons:[...nav.querySelectorAll('button[data-view]')].filter(e=>e.getClientRects().length).map(r),
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
    });
    assert.deepEqual(bounds.groups,[],'collapsed header hides every navigation group label');
    assert.ok(bounds.nav.top >= bounds.top.top && bounds.nav.bottom <= bounds.top.bottom,'all tabs fit inside title bar height');
    assert.ok(bounds.nav.right <= bounds.actions.left-4,'tabs do not overlap Settings/window controls');
    for (const lead of bounds.lead) assert.ok(bounds.nav.left >= lead.right+4,'tabs do not overlap brand/sidebar toggle');
    assert.ok(bounds.buttons.every(b=>Math.abs(b.top-bounds.buttons[0].top)<=1),'all tabs use one row');
    assert.ok(bounds.overflow<=1,'navigation does not widen the window');
  }).toPass({timeout:5000});
}

for (const engine of engines) for (const lang of ['en','zh','zh-TW','ja','de']) {
  test(`${engine} ${lang}: collapsed account navigation fits, scrolls and tracks the active destination`, async ctx => {
    const {page,verify}=await consoleSetup(ctx,engine,lang,1280,'authenticated',{native:true,zoom:1.25});
    await page.goto(origin+'/?view=stallion-wallet&account=%2Fpersonal%2Flog');
    const frame=page.frameLocator('iframe.stxc-frame');
    await frame.getByText('fixture-model',{exact:true}).waitFor();
    await page.locator('#sideToggle').click();
    await expect(page.locator('body')).not.toHaveClass(/side-nav/);
    await headerFits(page);
    // Late account bootstrap must fit even when the saved layout is already top.
    await page.reload();
    await page.locator('#nav [data-stx-route="/profile/teams"]').waitFor();
    await headerFits(page);
    for (const width of [900,560,1280]) {
      await page.setViewportSize({width,height:850});
      await expect.poll(()=>page.locator('#nav').evaluate(n=>n.getBoundingClientRect().bottom<=document.querySelector('.top').getBoundingClientRect().bottom)).toBe(true);
      await headerFits(page);
      await page.locator('#nav [data-stx-route="/profile"]').focus();
      await page.keyboard.press('Enter');
      await frame.getByRole('textbox').first().waitFor();
      await expect(page.locator('#nav [aria-current="page"]')).toHaveCount(1);
      const active=await page.locator('#nav [aria-current="page"]').evaluate(b=>{
        const r=b.getBoundingClientRect(),n=b.parentElement.getBoundingClientRect();return r.left>=n.left-1&&r.right<=n.right+1;
      });
      assert.ok(active,'selected destination is visible inside the scrolling strip');
      await expect.poll(()=>page.locator('#nav').evaluate(n=>{
        const a=n.querySelector('button.on').getBoundingClientRect(),h=n.querySelector('.thumb').getBoundingClientRect();
        return Math.abs(a.left-h.left)<2 && Math.abs(a.width-h.width)<2;
      }),{message:'native selection thumb follows the actual account route'}).toBe(true);
      if (width === 560) {
        const before=await page.locator('#nav').evaluate(n=>n.scrollLeft);
        const box=await page.locator('#nav').boundingBox();
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
        await page.mouse.wheel(0,-240);
        await expect.poll(()=>page.locator('#nav').evaluate(n=>n.scrollLeft)).toBeLessThan(before);
      }
    }
    await frame.locator('[data-testid="workspace-switcher"]').click();
    await frame.getByRole('button').filter({hasText:'Fixture Team'}).click();
    await page.locator('#nav [data-stx-route="/team/fixture-team/settings"]').waitFor();
    await headerFits(page);
    await page.setViewportSize({width:560,height:850});
    await headerFits(page);
    await page.locator('#sideToggle').click();
    await expect(page.locator('body')).toHaveClass(/side-nav/);
    assert.ok(await page.locator('#nav .stxc-nav-group:visible').count()>0,'groups return in sidebar layout');
    verify();
  });
}

async function hiddenNavigation(page, frame, lang) {
  const paths = await page.locator('#nav [data-stx-route]').evaluateAll(nodes => nodes.map(n => n.dataset.stxRoute));
  assert.ok(paths.every(p => !/\/(playground|models|subscription|my-subscription)$/.test(p)), 'hidden menus stay out of personal/team sidebar');
  await frame.locator('[aria-keyshortcuts="Meta+K Control+K"]').click();
  const dialog = frame.getByRole('dialog');
  await dialog.waitFor();
  const labels = lang === 'zh' ? ['Playground','模型与价格','套餐订阅','订阅用量'] : ['Playground','Models & pricing','Plans','Subscription usage'];
  for (const label of labels) {
    assert.equal(await dialog.getByText(label,{exact:true}).count(),0,`${label} stays out of navigation search`);
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
}

async function nativeAppearance(page, frame) {
  const expected = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return Object.fromEntries(['bg','card','line','fg','accent','c1'].map(k=>[k,s.getPropertyValue('--'+k).trim()]));
  });
  await expect.poll(() => frame.locator('html').evaluate(e=>getComputedStyle(e).getPropertyValue('--background').trim())).toBe(expected.bg);
  const actual = await frame.locator('html').evaluate(e=>{
    const s=getComputedStyle(e);
    return Object.fromEntries(Object.entries({bg:'background',card:'card',line:'border',fg:'foreground',accent:'primary',c1:'chart-1'}).map(([key,v])=>[key,s.getPropertyValue('--'+v).trim()]));
  });
  assert.deepEqual(actual,expected,'Web semantic tokens are the native palette');
  const font = await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily);
  assert.equal(await frame.locator('body').evaluate(e=>getComputedStyle(e).fontFamily),font,'native font follows into the frame');
  assert.equal(await frame.locator('html').evaluate(e=>getComputedStyle(e).zoom),'1','no second text-size zoom');
}

for (const engine of engines) for (const lang of ['en','zh']) for (const width of [1280,390]) {
  test(`${engine} ${lang} ${width}: Web console shares login, compact controls, inline billing and teams`, async ctx => {
    const {page,f,requests,unsupported,verify} = await consoleSetup(ctx,engine,lang,width);
    await page.goto(origin+'/?view=stallion-wallet&account=%2Fpersonal%2Flog');
    const frame = page.frameLocator('iframe.stxc-frame');
    await frame.getByText('fixture-model',{exact:true}).waitFor();
    assert.equal(await page.locator('#stxUserGate').isVisible(),false,'no second sign-in');
    await page.locator('#nav [data-stx-route="/profile"]').waitFor({state:'attached'});
    assert.equal(await page.locator('#nav [data-stx-route]').count(),8,'separate native destinations');
    assert.equal(await frame.locator('[data-slot="sidebar"]').count(),0,'no duplicate Web sidebar');
    await hiddenNavigation(page,frame,lang);
    await nativeAppearance(page,frame);
    const row = frame.locator('tbody tr').filter({has:frame.getByRole('button',{name:/request_fixture/})});
    await row.click();
    const detail = frame.locator('[data-stx-log-detail]');
    await expect(detail).toBeVisible();
    assert.equal(await frame.getByRole('dialog').count(),0,'billing expands in the list, not a modal');
    assert.match(await detail.innerText(), /\/v1\/chat\/completions/);
    await row.click();
    await expect(detail).toHaveCount(0);
    const expand = frame.getByRole('button',{name:/request_fixture/});
    await expand.focus();
    await page.keyboard.press('Enter');
    await expect(expand).toHaveAttribute('aria-expanded','true');
    await expect(detail).toBeVisible();
    assert.ok(await frame.locator('html').evaluate(e=>e.scrollWidth-e.clientWidth) <= 1,'expanded billing fits narrow viewport');
    await page.keyboard.press('Enter');
    await expect(detail).toHaveCount(0);
    if (width >= 768) assert.ok(await row.evaluate(e=>e.getBoundingClientRect().height) <= 46,'compact log row');
    await page.evaluate(() => document.querySelector('#nav [data-stx-route="/personal/token"]').click());
    await frame.getByText('Fixture API Key',{exact:true}).waitFor();
    await frame.getByRole('button',{name:'Fixture API Key',exact:true}).click();
    await frame.getByRole('dialog').waitFor();
    assert.match(await frame.getByRole('dialog').innerText(), /\*\*\*\*1234/);
    await page.keyboard.press('Escape');
    await frame.getByRole('dialog').waitFor({state:'hidden'});
    assert.ok(!requests.some(r => r.path === '/api/token/'+keyID),'key list does not reveal secret');
    await page.evaluate(() => document.querySelector('#nav [data-stx-route="/profile"]').click());
    await frame.getByRole('textbox').first().waitFor();
    await expect(frame.getByRole('textbox').first()).toHaveValue('Fixture Reader');
    if (width >= 768) {
      const height = await frame.getByRole('textbox').first().evaluate(e=>e.getBoundingClientRect().height);
      assert.ok(height >= 28 && height <= 32,`compact desktop input (${height}px)`);
      assert.ok(parseFloat(await frame.getByRole('textbox').first().evaluate(e=>getComputedStyle(e).fontSize)) >= 14,'density does not shrink form text');
    }
    await frame.getByRole('textbox').first().fill('Unsaved fixture draft');
    // Native Settings and OS appearance updates must not remount an account form.
    await page.evaluate(() => { params.set('theme','dark'); document.documentElement.dataset.theme='dark'; });
    await nativeAppearance(page,frame);
    await expect(frame.getByRole('textbox').first()).toHaveValue('Unsaved fixture draft');
    await frame.locator('[data-slot="dropdown-menu-trigger"]').filter({has:frame.locator('[data-slot="avatar"]')}).click();
    assert.equal(await frame.getByRole('group',{name:lang==='zh'?'界面外观':'Appearance',exact:true}).count(),0,'appearance has one native owner');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--ui-font','Georgia, serif');
      document.documentElement.dataset.colorblind='1';
    });
    await expect.poll(()=>frame.locator('body').evaluate(e=>getComputedStyle(e).fontFamily)).toContain('Georgia');
    await nativeAppearance(page,frame);
    await page.evaluate(() => { document.documentElement.style.removeProperty('--ui-font'); delete document.documentElement.dataset.theme; params.set('theme','system'); });
    await page.emulateMedia({colorScheme:'dark'});
    await nativeAppearance(page,frame);
    await page.emulateMedia({colorScheme:'light'});
    await nativeAppearance(page,frame);
    await expect(frame.getByRole('textbox').first()).toHaveValue('Unsaved fixture draft');
    await page.evaluate(() => document.querySelector('#nav [data-stx-route="/orders"]').click());
    await frame.locator('[data-slot="select-trigger"]').waitFor();
    const action = frame.locator('main [data-slot="button"][data-variant="default"]').first();
    assert.equal(await action.evaluate(e=>getComputedStyle(e).backgroundColor),await page.evaluate(()=>{
      const probe=document.createElement('span'); probe.style.background='var(--card)'; document.body.append(probe);
      const value=getComputedStyle(probe).backgroundColor; probe.remove(); return value;
    }),'actions use native neutral surfaces');
    await page.evaluate(() => document.querySelector('#nav [data-stx-route="/topup"]').click());
    await frame.locator('input').first().waitFor();
    assert.ok(!requests.some(r => r.method === 'POST'),'viewing recharge never creates a payment');
    await frame.locator('[data-testid="workspace-switcher"]').click();
    await frame.getByRole('button').filter({hasText:'Fixture Team'}).click();
    // Switch directly to a fixture-backed team list, preserving real authorized resolution.
    await page.locator('#nav [data-stx-route="/team/fixture-team/tokens"]').waitFor({state:'attached'});
    await page.evaluate(() => document.querySelector('#nav [data-stx-route="/team/fixture-team/tokens"]').click());
    await frame.getByText('Fixture API Key',{exact:true}).waitFor();
    assert.equal(await page.locator('#nav [data-stx-route="/topup"]').count(),0,'team wallet is not personal recharge');
    await hiddenNavigation(page,frame,lang);
    await page.evaluate(() => document.querySelector('#nav [data-stx-route="/team/fixture-team/logs"]').click());
    await frame.getByRole('button',{name:/request_fixture/}).click();
    await expect(detail).toBeVisible();
    assert.equal(await frame.getByRole('dialog').count(),0,'team billing uses the same inline disclosure');
    assert.ok(requests.some(r=>r.path === '/api/team/team_fixture/tokens'));
    const overflow = await frame.locator('html').evaluate(e=>e.scrollWidth-e.clientWidth);
    assert.ok(overflow <= 1, `console fits ${width}px (${overflow})`);
    f.state='signed_out';
    await page.evaluate(()=>stxUser.refresh());
    await page.locator('#stxUserGate').waitFor();
    assert.equal(await page.locator('iframe.stxc-frame').count(),0,'sign-out destroys frame data');
    assert.deepEqual(unsupported,[]);
    verify();
  });
}
