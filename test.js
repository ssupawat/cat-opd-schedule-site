// Regression suite for index.html: Playwright against a mocked nori API.
// Usage: node test.js [page-url]   (test.sh starts a local server and runs this)
const { chromium } = require("playwright");

const PAGE_URL = process.argv[2] || "http://localhost:8000/index.html";
const CACHE_KEY = "cat-opd-doctors-v4";
const API = "https://nori-ef28.fly.dev";
const DAY_COLS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];

let total = 0, failed = 0;
function check(name, expected, actual) {
  total++;
  if (JSON.stringify(expected) === JSON.stringify(actual)) console.log("✓ " + name);
  else { failed++; console.log(`✗ ${name} — expected [${JSON.stringify(expected)}], got [${JSON.stringify(actual)}]`); }
}

const row = (id, name, spec, extra = {}) =>
  ({ id, ชื่อ: name, แผนก: spec, ประเภท: "ปกติ", ...Object.fromEntries(DAY_COLS.map(d => [d, ""])), หมายเหตุ: "", ...extra });
const seedRows = () => [
  row("1", "นพ.ตัวอย่าง หนึ่ง", "อายุรกรรม", { จันทร์: "09:00-12:00", ศุกร์: "09:00-12:00, 13:00-16:00", หมายเหตุ: "จำลอง" }),
  row("2", "พญ.ตัวอย่าง สอง", "ศัลยกรรม", { อังคาร: "09:00-12:00" }),
  row("3", "นพ.ตัวอย่าง สาม", "กุมารเวชกรรม"),
];

// A fake nori: login, rows CRUD gated by role (builder gets 403 on rows), password change, logout.
function mockNori(ctx, role, opts = {}) {
  const state = { rows: seedRows(), calls: [], nextId: 100, password: "right", rowsStatus: opts.rowsStatus || 0 };
  ctx.route(API + "/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    state.calls.push({ method, path, body });
    const json = (status, data) => route.fulfill({ status, json: data });
    if (path === "/api/login") return body.password === "bad" ? json(401, { error: "invalid" }) : json(200, { token: "tok", username: role + "1", role });
    if (path === "/api/logout") return json(200, { status: "ok" });
    if (path === "/api/me") return json(200, { username: role + "1", role });
    if (path === "/api/me/password")
      return body.currentPassword === state.password ? json(200, { status: "ok" }) : json(401, { error: "wrong password" });
    const m = path.match(/^\/api\/tables\/schedule\/rows(?:\/(.+))?$/);
    if (m) {
      if (state.rowsStatus) return json(state.rowsStatus, { error: "nope" });
      if (role === "builder") return json(403, { error: "insufficient role" });
      if (method === "GET") return json(200, { rows: state.rows, total: state.rows.length });
      if (role === "viewer") return json(403, { error: "insufficient role" });
      if (method === "POST") { const r = { id: String(state.nextId++), ...body }; state.rows.push(r); return json(201, r); }
      const i = state.rows.findIndex(r => r.id === m[1]);
      if (i < 0) return json(404, { error: "not found" });
      if (method === "PATCH") { Object.assign(state.rows[i], body); return json(200, state.rows[i]); }
      if (method === "DELETE") { state.rows.splice(i, 1); return json(200, { status: "ok" }); }
    }
    return json(404, { error: "unmocked " + path });
  });
  return state;
}

async function open(browser, role, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
  const state = mockNori(ctx, role, opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", d => d.accept());
  await page.goto(PAGE_URL);
  return { ctx, page, state, errors };
}

async function login(page, role, password = "x") {
  await page.waitForSelector("#login");
  await page.fill("[name=username]", role + "1");
  await page.fill("[name=password]", password);
  await page.click("#login button");
}

async function signedIn(browser, role, opts) {
  const s = await open(browser, role, opts);
  await login(s.page, role);
  await s.page.waitForSelector(role === "builder" || opts?.rowsStatus ? "h1" : ".list", { timeout: 10000 });
  await s.page.waitForTimeout(200);
  return s;
}

const count = (page, sel) => page.locator(sel).count();
const text = (page, sel) => page.locator(sel).first().textContent();
const has = async (page, sel) => (await count(page, sel)) > 0;

(async () => {
  const browser = await chromium.launch();

  // ---- signed out: login form, bad credentials ----
  {
    const { ctx, page } = await open(browser, "viewer");
    check("login form shown when signed out", true, await has(page, "#login"));
    await login(page, "viewer", "bad");
    await page.waitForFunction(() => document.getElementById("err").textContent);
    check("bad credentials show an error", "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", await text(page, "#err"));
    check("still on login form", true, await has(page, "#login"));

    // ---- site essentials ----
    check("favicon is cat png", true, await has(page, 'link[rel="icon"][href="icon-192.png"]'));
    check("theme-color light+dark", 2, await count(page, "meta[name=theme-color]"));
    check("meta description set", true, (await page.getAttribute("meta[name=description]", "content")).length > 0);
    check("noscript fallback present", true, (await count(page, "noscript")) === 1);
    await ctx.close();
  }

  // ---- viewer: read-only ----
  {
    const { ctx, page, state, errors } = await signedIn(browser, "viewer");
    check("viewer: list rendered", 3, await count(page, ".list li"));
    check("viewer: user bar shows name and role", "viewer1 · viewer", (await text(page, ".top .role")).replace("👤", "").trim());
    check("viewer: no add button", false, await has(page, 'a[href="#new"]'));
    check("viewer: updated timestamp shown", true, /อัปเดต/.test(await text(page, ".count")));
    const cache = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), CACHE_KEY);
    check("viewer: cache populated with row ids", ["1", "2", "3"], cache.doctors.map(d => d.rowId));

    await page.click(".list li a");
    await page.waitForSelector("table");
    check("viewer: doctor view opens", true, await has(page, "table"));
    check("viewer: user bar on doctor page", true, await has(page, ".top .role"));
    check("viewer: no edit button", false, await has(page, 'a[href^="#edit/"]'));
    const id = await page.evaluate(() => DOCTORS[0].id);
    await page.evaluate(i => { location.hash = "#edit/" + i; }, id);
    await page.waitForTimeout(150);
    check("viewer: #edit/<id> does not open the form", false, await has(page, "form.edit"));
    await page.evaluate(() => { location.hash = "#new"; });
    await page.waitForTimeout(150);
    check("viewer: #new does not open the form", false, await has(page, "form.edit"));
    check("viewer: no write calls", [], state.calls.filter(c => c.method !== "GET" && c.path.includes("/rows")));
    check("viewer: no page errors", [], errors);
    await ctx.close();
  }

  // ---- editor: add / edit / delete ----
  {
    const { ctx, page, state, errors } = await signedIn(browser, "editor");
    check("editor: add button shown", true, await has(page, 'a[href="#new"]'));
    check("editor: add button has no underline", "none", await page.$eval('a[href="#new"]', el => getComputedStyle(el).textDecorationLine));

    await page.click('a[href="#new"]');
    await page.waitForSelector("form.edit");
    check("editor: form has name, dept, type, 7 days, note", 11, await count(page, "form.edit input, form.edit textarea"));
    await page.fill("[name=ชื่อ]", "นพ.ใหม่ ทดสอบ");
    await page.fill("[name=แผนก]", "ตา");
    await page.fill("[name=พุธ]", "10:00-12:00");
    await page.click("form.edit button[type=submit]");
    await page.waitForSelector("table");
    const post = state.calls.find(c => c.method === "POST" && c.path.endsWith("/rows"));
    check("editor: POST body", { ชื่อ: "นพ.ใหม่ ทดสอบ", แผนก: "ตา", พุธ: "10:00-12:00" },
      { ชื่อ: post.body["ชื่อ"], แผนก: post.body["แผนก"], พุธ: post.body["พุธ"] });
    check("editor: lands on the new doctor's page", "นพ.ใหม่ ทดสอบ", await text(page, "h1"));

    await page.click('a[href^="#edit/"]');
    await page.waitForSelector("form.edit");
    check("editor: edit form prefilled", "ตา", await page.inputValue("[name=แผนก]"));
    await page.fill("[name=แผนก]", "จักษุ");
    await page.click("form.edit button[type=submit]");
    await page.waitForSelector("table");
    const patch = state.calls.find(c => c.method === "PATCH");
    check("editor: PATCH targets the row id", "/api/tables/schedule/rows/100", patch.path);
    check("editor: PATCH carries the change", "จักษุ", patch.body["แผนก"]);
    check("editor: view shows updated dept", "จักษุ", await text(page, ".meta"));

    await page.click('a[href^="#edit/"]');
    await page.waitForSelector("form.edit");
    await page.click("#del");
    await page.waitForSelector(".list");
    check("editor: DELETE sent", true, state.calls.some(c => c.method === "DELETE" && c.path.endsWith("/rows/100")));
    check("editor: back on list, doctor gone", 3, await count(page, ".list li"));
    check("editor: no page errors", [], errors.filter(e => !/403|404/.test(e)));
    await ctx.close();
  }

  // ---- editor: write rejected shows an error and keeps the form ----
  {
    const { ctx, page } = await signedIn(browser, "editor");
    await page.click('a[href="#new"]');
    await page.waitForSelector("form.edit");
    await ctx.unroute(API + "/**");
    await ctx.route(API + "/**", r => r.fulfill({ status: 400, json: { error: "bad column" } }));
    await page.fill("[name=ชื่อ]", "x");
    await page.click("form.edit button[type=submit]");
    await page.waitForFunction(() => document.getElementById("err").textContent);
    check("editor: API error shown on form", "บันทึกไม่สำเร็จ: bad column", await text(page, "#err"));
    check("editor: form still open and re-enabled", true, await page.isEnabled("form.edit button[type=submit]"));
    await ctx.close();
  }

  // ---- builder: no access, but profile still works ----
  {
    const { ctx, page, errors } = await signedIn(browser, "builder");
    check("builder: no-access message", true, /ไม่มีสิทธิ์/.test(await text(page, ".empty")));
    check("builder: user bar shown", true, await has(page, ".top .role"));
    check("builder: no list", false, await has(page, ".list"));
    await page.click(".top .role");
    await page.waitForSelector("dl.info");
    await page.waitForTimeout(300);
    check("builder: profile stays open", true, await has(page, "dl.info"));
    await page.click("a.back");
    await page.waitForSelector(".empty");
    check("builder: back to no-access", true, /ไม่มีสิทธิ์/.test(await text(page, ".empty")));
    check("builder: no cache kept", null, await page.evaluate(k => localStorage.getItem(k), CACHE_KEY));
    check("builder: no page errors", [], errors.filter(e => !/ForbiddenError/.test(e)));
    await ctx.close();
  }

  // ---- profile: info + change password ----
  {
    const { ctx, page, errors } = await signedIn(browser, "editor");
    await page.click(".top .role");
    await page.waitForSelector("dl.info");
    const info = await text(page, "dl.info");
    check("profile: shows username and role", true, info.includes("editor1") && info.includes("editor"));
    check("profile: shows sign-in time", false, /เข้าสู่ระบบเมื่อ-/.test(info.replace(/\s/g, "")));

    const fill = async (cur, nw, again) => {
      await page.fill("[name=cur]", cur); await page.fill("[name=new]", nw); await page.fill("[name=again]", again);
      await page.click("#pw button");
    };
    await fill("right", "newpass123", "different1");
    check("profile: mismatch is rejected locally", "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน", await text(page, "#err"));
    await fill("wrong", "newpass123", "newpass123");
    await page.waitForFunction(() => document.getElementById("err").textContent);
    check("profile: wrong current password keeps the session", "รหัสผ่านปัจจุบันไม่ถูกต้อง", await text(page, "#err"));
    check("profile: still signed in", true, await has(page, "dl.info"));
    await fill("right", "newpass123", "newpass123");
    await page.waitForFunction(() => document.getElementById("ok").textContent);
    check("profile: success message", "เปลี่ยนรหัสผ่านแล้ว", await text(page, "#ok"));
    check("profile: fields cleared", "", await page.inputValue("[name=cur]"));
    check("profile: no page errors", [], errors.filter(e => !/401/.test(e)));
    await ctx.close();
  }

  // ---- cache + reload + stale-while-revalidate + routing ----
  {
    const { ctx, page, state, errors } = await signedIn(browser, "viewer");
    await page.reload();
    await page.waitForSelector(".list");
    check("renders after reload (token persisted)", 3, await count(page, ".list li"));

    await page.evaluate(k => localStorage.setItem(k, JSON.stringify({
      savedAt: Date.now(), doctors: [{ id: "x", rowId: "x", row: {}, name: "TESTDOCTORCACHE", spec: "T", note: "", schedule: [] }] })), CACHE_KEY);
    // hold the network so the seeded cache is what paints first
    let release; const gate = new Promise(r => { release = r; });
    await ctx.route(API + "/api/tables/**", async r => { await gate; r.fallback(); });
    await page.reload();
    await page.waitForFunction(() => document.body.innerText.includes("TESTDOCTORCACHE"));
    check("cache-first paint of seeded data", true, true);
    release();
    await page.waitForFunction(() => !document.body.innerText.includes("TESTDOCTORCACHE") && !!document.querySelector(".list"));
    check("background refresh re-renders fresh data", 3, await count(page, ".list li"));
    check("cache overwritten with fresh data", false, (await page.evaluate(k => localStorage.getItem(k), CACHE_KEY)).includes("TESTDOCTORCACHE"));

    check("doctor ids are name hashes", true, await page.evaluate(() => DOCTORS.length > 0 && DOCTORS.every(d => /^d[0-9a-f]+$/.test(d.id))));
    await page.evaluate(() => { location.hash = "#" + DOCTORS[0].id; });
    await page.waitForSelector("table");
    check("doctor view opens via hash", true, await has(page, "table"));
    await page.evaluate(() => { location.hash = ""; });
    await page.waitForSelector(".list");
    check("back to list via hash", true, await has(page, ".list"));

    // search + filter
    await page.fill("#q", "ศัลย");
    check("search filters the list", 1, await count(page, ".list li"));
    await page.fill("#q", "");
    await page.click('.chip[data-spec="อายุรกรรม"]');
    check("department chip filters the list", 1, await count(page, ".list li"));

    check("no page errors", [], errors);
    check("config applied", true, await page.evaluate(() => API_URL.startsWith("https://") && !!TABLE && DAYS.length === 7 && ORDER.length === 7));

    // ---- logout clears the session and revokes the token ----
    await page.click("#logout");
    await page.waitForSelector("#login");
    check("logout: login form back", true, await has(page, "#login"));
    check("logout: auth and cache cleared", [null, null],
      await page.evaluate(k => [localStorage.getItem("cat-opd-auth-v1"), localStorage.getItem(k)], CACHE_KEY));
    await page.waitForTimeout(200);
    check("logout: /api/logout called", true, state.calls.some(c => c.path === "/api/logout"));
    await ctx.close();
  }

  // ---- expired session ----
  {
    const { ctx, page } = await signedIn(browser, "viewer");
    await ctx.unroute(API + "/**");
    await ctx.route(API + "/**", r => r.fulfill({ status: 401, json: { error: "expired" } }));
    await page.reload();
    await page.waitForSelector("#login");
    check("401 returns to login with a message", "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", await text(page, "#err"));
    await ctx.close();
  }

  // ---- PWA: manifest, service worker, offline reload ----
  {
    const { ctx, page, errors } = await signedIn(browser, "viewer");
    check("manifest reachable", true, await page.evaluate(() => fetch("manifest.webmanifest").then(r => r.ok)));
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 });
    check("service worker controls page", true, true);
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector(".list");
    check("offline: app renders from cache", 3, await count(page, ".list li"));
    await ctx.setOffline(false);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n=== ${total - failed}/${total} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
