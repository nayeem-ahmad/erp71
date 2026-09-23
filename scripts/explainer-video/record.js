// Drives the real app through one sale and records it via a CDP screencast,
// then encodes docs/user-manual/videos/sales-entry.mp4. See README.md.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = __dirname;
const BASE = process.env.BASE_URL || 'http://localhost:3000';
// VIDEO_LANG=bn records the Bangla version: same scenes, captions, labels and
// cards from lang/bn.json. The app UI itself stays in English.
const LANG = process.env.VIDEO_LANG || 'en';
const copy = JSON.parse(fs.readFileSync(path.join(DIR, 'lang', `${LANG}.json`), 'utf8'));
const OUT = path.resolve(DIR, '../../docs/user-manual/videos', LANG === 'en' ? 'sales-entry.mp4' : `sales-entry.${LANG}.mp4`);
const W = 1440, H = 900;
// Voice-over from narrate.py. Absent means a silent recording.
const VOICE_FILE = path.join(DIR, '.audio', LANG, 'durations.json');
const voice = fs.existsSync(VOICE_FILE) ? JSON.parse(fs.readFileSync(VOICE_FILE, 'utf8')) : null;

(async () => {
  const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(DIR, 'fonts', f)).toString('base64');
  const overlay = fs.readFileSync(path.join(DIR, 'overlay.js'), 'utf8')
    .replace('__CAVEAT__', font('caveat.woff2'))
    .replace('__GALADA__', font('galada-bengali-400-normal.woff2'))
    .replace('__HIND_400__', font('hind-siliguri-bengali-400-normal.woff2'))
    .replace('__HIND_700__', font('hind-siliguri-bengali-700-normal.woff2'));

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript(overlay);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(180000);

  // ── login (not recorded) ───────────────────────────────────────────────
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder*="name@company"]', 'nayeem.ahmad@gmail.com');
  await page.fill('input[type=password]', 'password123');
  await page.keyboard.press('Enter');
  await page.click('text=Dhaka Retail Co.');
  await page.waitForURL('**/dashboard');
  await page.waitForLoadState('networkidle');
  // Visit every page once before recording, so a dev server compiles them
  // now rather than leaving dead air in the middle of the video.
  for (const warm of ['/sales/list', '/sales/new']) {
    await page.goto(BASE + warm, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
  }
  await page.goto(BASE + '/sales', { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  await page.evaluate(() => { __ov.ensure(); __ov.showCursor(false); });

  // ── screencast ─────────────────────────────────────────────────────────
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-entry-frames-'));
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(frameDir, String(frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

  // ── helpers ────────────────────────────────────────────────────────────
  const wait = (ms) => page.waitForTimeout(ms);
  // Hand-drawn labels are written in English here and swapped for the
  // language's own on the way into the page.
  const label = (text) => {
    if (LANG === 'en' || typeof text !== 'string') return text;
    if (!copy.labels?.[text]) throw new Error(`lang/${LANG}.json has no label for "${text}"`);
    return copy.labels[text];
  };
  const ov = (fn, ...args) => {
    if (fn === 'box') args[1] = label(args[1]);
    if (fn === 'label') args[0] = label(args[0]);
    return page.evaluate(([fn, args]) => __ov[fn](...args), [fn, args]);
  };
  const caption = (n, title, body) => {
    if (LANG === 'en') return ov('caption', n, title, body);
    const t = copy.captions?.[title];
    if (!t) throw new Error(`lang/${LANG}.json has no caption for "${title}"`);
    return ov('caption', n, t[0], t[1]);
  };
  const box = async (loc) => {
    const b = await (typeof loc === 'string' ? page.locator(loc).first() : loc).boundingBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  const union = (...rs) => {
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    const x2 = Math.max(...rs.map((r) => r.x + r.w)), y2 = Math.max(...rs.map((r) => r.y + r.h));
    return { x, y, w: x2 - x, h: y2 - y };
  };
  const moveTo = async (loc, ox = 0.5, oy = 0.5) => {
    const r = await box(loc);
    const x = r.x + r.w * ox, y = r.y + r.h * oy;
    await ov('move', x, y);
    await wait(800);
    return { x, y };
  };
  const click = async (loc, opts = {}) => {
    const l = typeof loc === 'string' ? page.locator(loc).first() : loc;
    const { x, y } = await moveTo(l, opts.ox ?? 0.5, opts.oy ?? 0.5);
    await ov('ripple', x, y);
    await l.click({ position: undefined });
    await wait(opts.after ?? 400);
  };
  const type = async (loc, text, opts = {}) => {
    const l = typeof loc === 'string' ? page.locator(loc).first() : loc;
    await click(l, { ox: opts.ox ?? 0.3 });
    if (opts.clear) { await l.selectText(); await wait(150); }
    await l.pressSequentially(text, { delay: opts.delay ?? 110 });
    await wait(opts.after ?? 600);
  };
  // Each spoken line starts only once the previous one has finished, and the
  // wall-clock start of each is kept so the clips can be laid onto the video.
  const cues = [];
  let voiceEnd = 0;
  const holdVoice = async () => { const left = voiceEnd - Date.now(); if (left > 0) await wait(left); };
  const narrate = async (key) => {
    if (!voice) return;
    if (!voice[key]) throw new Error(`narration.json has no line for "${key}"`);
    await holdVoice();
    cues.push({ ...voice[key], t: Date.now() / 1000 });
    voiceEnd = Date.now() + voice[key].dur * 1000 + 400;
  };
  const say = async (n, title, body, hold = 0) => { await narrate(title); await caption(n, title, body); await wait(hold); };
  // Scene-ending clear: keeps the drawings up until the voice has finished
  // talking about them. Mid-scene tidying uses ov('clear') directly.
  const clear = async () => { await holdVoice(); await ov('clear'); };

  const cardHtml = (k, h, p, extra = '') => `<div class="k">${k}</div><h1>${h}</h1><p>${p}</p>${extra}`;
  const card = (name, html) => ov('card', LANG === 'en' ? html : copy.cards[name]);

  // ── 0. title card ──────────────────────────────────────────────────────
  await card('title', cardHtml('ERP71 · Sales',
    'How sales entry works',
    'Record a sale from start to finish — customer, products, discounts, payment and invoice — on one screen.',
    `<ol><li>Open New Sale</li><li>Pick the customer</li><li>Add products</li><li>Check totals &amp; take payment</li><li>Create the sale &amp; print</li></ol>`));
  await narrate('intro');
  await wait(6500);
  await holdVoice();
  await ov('card', null);
  await wait(700);

  // ── 1. getting there ───────────────────────────────────────────────────
  await ov('showCursor', true);
  await say(1, 'Open the New Sale screen', 'In the sidebar open <b>Sales → Sales</b>, then click <b>New Sales Entry</b> at the top right.');
  const listLink = page.locator('a[href="/sales/list"]:visible').first();
  await ov('box', await box(listLink), 'Sales list', { pos: 'right', pad: 4 });
  await wait(1500);
  await click(listLink, { after: 0 });
  await page.waitForURL('**/sales/list');
  await page.waitForLoadState('networkidle');
  await ov('clear');
  const newSale = page.locator('a:visible, button:visible', { hasText: /New Sales? Entry|New Sale/ }).first();
  await ov('box', await box(newSale), 'start a new sale', { pos: 'below', pad: 5 });
  await wait(1800);
  await click(newSale, { after: 0 });
  await page.waitForURL('**/sales/new');
  await page.waitForSelector('text=No items yet');
  await wait(900);
  await clear();

  // ── 2. screen tour ─────────────────────────────────────────────────────
  const meta = await box(page.locator('h1', { hasText: 'New Sale' }).locator('xpath=ancestor::div[contains(@class,"border-b")][1]'));
  const leftTop = await box('input[placeholder="Search by name or phone…"]');
  const table = await box(page.locator('th', { hasText: 'NAME' }).locator('xpath=ancestor::div[contains(@class,"border")][1]').first()).catch(() => null);
  const totalLbl = await box(page.getByText('Subtotal', { exact: true }));
  const createBtn = await box(page.getByRole('button', { name: 'Create Sale' }));

  await say(2, 'One screen, three areas', 'Everything for the sale lives on this page — nothing to jump between.');
  await ov('box', { x: meta.x + 4, y: meta.y + 4, w: meta.w - 8, h: meta.h - 8 }, 'A · document details', { pos: 'below', pad: 2, dx: -300 });
  await wait(1600);
  const leftArea = { x: leftTop.x, y: leftTop.y - 22, w: (totalLbl.x - 24) - leftTop.x, h: 860 - leftTop.y };
  await ov('box', leftArea, 'B · who is buying & what', { pos: 'above', pad: 4, dy: 330 });
  await wait(1600);
  const panel = { x: totalLbl.x - 4, y: totalLbl.y - 10, w: W - totalLbl.x - 8, h: createBtn.y + createBtn.h - totalLbl.y + 14 };
  await ov('box', panel, 'C · totals & payment', { pos: 'above', pad: 4, dy: 470 });
  await wait(3200);
  await clear();

  // ── 3. document details ────────────────────────────────────────────────
  await say(3, 'A · Document details',
    '<b>Sales #</b> is numbered automatically. <b>Ref #</b> is optional (e.g. a hand-written memo number). <b>Date</b> defaults to now, and <b>Warehouse</b> is where the stock leaves from.');
  const sn = await box(page.getByText('Sales #', { exact: false }).first());
  await ov('box', { ...sn, w: sn.w + 50 }, 'auto', { pos: 'below', pad: 5 });
  await wait(900);
  const ref = await box(page.locator('input[placeholder="Optional"]'));
  await ov('box', ref, 'optional', { pos: 'below', pad: 5 });
  await wait(900);
  const dt = await box('input[type="datetime-local"]');
  await ov('box', dt, 'defaults to now', { pos: 'below', pad: 5 });
  await wait(900);
  const wh = await box(page.locator('select[aria-label="Warehouse"]').first());
  await ov('box', wh, 'stock leaves from here', { pos: 'below', pad: 5 });
  await wait(4200);
  await clear();

  // ── 4. shift chip ──────────────────────────────────────────────────────
  const shift = await box(page.getByText('No open shift').locator('xpath=ancestor::div[1]'));
  await say(4, 'Till / cashier shift',
    'If a cashier shift is open, the sale is stamped to that till for end-of-day cash counting. With no shift open you can still sell — the sale just isn\'t tied to a till.');
  await ov('box', union(shift, { ...shift, w: 420 }), 'which till gets this sale', { pos: 'right', pad: 6, dx: 0 });
  await wait(5500);
  await clear();

  // ── 5. customer ────────────────────────────────────────────────────────
  await say(5, 'B · Pick the customer',
    'Search by <b>name or phone</b>. Selecting shows their phone, address and any <b>due balance</b>. Use <b>+</b> to add a new customer on the spot — or leave it empty for a walk-in who pays in full.');
  await type('input[placeholder="Search by name or phone…"]', 'Rahim', { after: 1400 });
  const opt = page.getByText('Rahim Chowdhury').last();
  await click(opt, { after: 1200 });
  const custCard = await box(page.getByText('Mirpur-10, Dhaka').locator('xpath=ancestor::div[2]'));
  await ov('box', custCard, 'phone · due · address', { pos: 'below', pad: 6 });
  const plus = await box(page.getByRole('button', { name: /new customer/i }));
  await ov('box', plus, '+ new customer', { pos: 'above', pad: 4, delay: 700 });
  await wait(5200);
  await clear();

  // ── 6. first product ───────────────────────────────────────────────────
  const product = page.locator('input[aria-label="Product"]');
  await say(6, 'Add products',
    'Type part of a product name or SKU. The list shows <b>price</b> and <b>stock available</b>. Press <b>Enter</b> to pick the highlighted one.');
  await type(product, 'Basmati', { after: 1500 });
  const dd = await box(page.getByText('SKU: GRN-001').locator('xpath=ancestor::*[self::li or self::button or self::div][2]'));
  await ov('box', dd, 'price & stock', { pos: 'right', pad: 4 });
  await wait(3000);
  await ov('clear');
  await product.press('Enter');
  await wait(900);

  await say(6, 'Check the price, set the quantity',
    'The unit price fills in from the product. <b>Previous sale rates</b> appear underneath so you can match what you charged before. Set <b>Qty</b> and click <b>Add</b> (or press Enter).');
  const hist = await box(page.getByText('Previous sale rates', { exact: false }).locator('xpath=ancestor::div[2]'));
  await ov('box', hist, 'what you charged before', { pos: 'below', pad: 4, dy: 18 });
  await wait(2500);
  const qty = page.locator('input[aria-label="Qty"]');
  await type(qty, '5', { clear: true, after: 700 });
  await click(page.getByRole('button', { name: 'Add', exact: true }), { after: 1400 });
  await clear();

  // ── 7. more products ───────────────────────────────────────────────────
  await say(7, 'Keep adding lines', 'The cursor jumps back to the product box, so you can scan or type the next item straight away.');
  const addLine = async (term, pick, q) => {
    await type(product, term, { after: 1100, delay: 90 });
    await product.press('Enter');
    await wait(700);
    await type(qty, q, { clear: true, after: 400, delay: 90 });
    await qty.press('Enter');
    await wait(1100);
  };
  await addLine('Sunflower', 'Sunflower Oil (1L)', '2');
  await addLine('Green tea', 'Green Tea Bags (25 pack)', '3');
  await wait(800);

  // ── 8. line items ──────────────────────────────────────────────────────
  await say(8, 'Review and edit the lines',
    'Each row shows <b>stock available</b>, the price and the qty — edit them right in the table, or use <b>− / +</b>. The line total updates as you type. The bin icon removes a line.');
  const tbl = await box(page.locator('table').first());
  await ov('box', { ...tbl, h: Math.min(tbl.h, 170) }, null, { pad: 4 });
  const avail = await box(page.locator('th', { hasText: /avail/i }).first());
  await ov('label', 'in stock', avail.x - 10, avail.y - 40, { delay: 900 });
  await wait(1800);
  const tq = page.locator('input[aria-label^="Qty — Green Tea"]');
  await type(tq, '4', { clear: true, after: 900 });
  const dr = await box(tq);
  await ov('arrow', dr.x - 120, dr.y + 90, dr.x - 4, dr.y + dr.h - 2);
  await ov('label', 'changed 3 → 4', dr.x - 300, dr.y + 92);
  await wait(4000);
  await clear();

  // ── 9. totals ──────────────────────────────────────────────────────────
  await say(9, 'C · Totals and discount',
    'Give a whole-bill <b>discount</b> as a <b>%</b> or a flat <b>৳</b> amount — toggle with the two small buttons. The <b>Total</b> is always live.');
  const discIn = page.locator('input[aria-label="Discount percent"]');
  await type(discIn, '5', { clear: true, after: 900 });
  const discRow = await box(page.getByText('Discount', { exact: true }).locator('xpath=..'));
  const totalRow = await box(page.locator('div.border-t.pt-2', { hasText: 'Total' }).first());
  await ov('box', discRow, '5% off the whole bill', { pos: 'left', pad: 4, dy: -30 });
  await ov('box', totalRow, null, { pad: 6, delay: 800, color: '#2563eb' });
  await ov('label', 'live total', totalRow.x + 4, totalRow.y + totalRow.h + 14, { color: '#2563eb', delay: 1300 });
  await wait(5000);
  await clear();

  // ── 10. payment ────────────────────────────────────────────────────────
  const totalText = (await page.locator('div.border-t.pt-2', { hasText: 'Total' }).first().innerText()).split('\n').pop();
  const total = Number(totalText.replace(/[^\d.]/g, ''));
  await say(10, 'Take payment — split it any way',
    'Enter what was paid in each method. Here the customer pays ৳500 by <b>mobile wallet</b> (bKash / Nagad) and the rest in <b>cash</b>.');
  await type('input[aria-label="Mobile Wallet amount"]', '500', { clear: true, after: 900 });
  const due = await box(page.getByText(/^Due /).first()).catch(() => null);
  if (due) { await ov('box', due, 'still owed', { pos: 'below', pad: 4 }); await wait(2200); await ov('clear'); }
  await type('input[aria-label="Cash amount"]', String(Math.round((total - 500) * 100) / 100), { clear: true, after: 900 });
  const settled = await box(page.getByText('✓ Settled').first());
  await ov('box', settled, 'fully paid ✓', { pos: 'below', pad: 5, color: '#059669' });
  await wait(3000);
  await say(10, 'Selling on credit?',
    'Leave part unpaid and the rest is <b>kept as due</b> on the customer\'s account (within their credit limit). A walk-in customer must pay in full.');
  await wait(5200);
  await clear();

  // ── 11. note ───────────────────────────────────────────────────────────
  await say(11, 'Add a note (optional)', 'Anything the next person should know — it is saved with the sale and printed on the invoice.');
  await type('input[aria-label="Note"]', 'Deliver to shop by 6 pm', { after: 1500, delay: 70 });

  // ── 12. actions ────────────────────────────────────────────────────────
  await say(12, 'Save it',
    '<b>Create Sale</b> posts stock, payments and accounts. <b>Save Draft</b> parks it without posting anything. The printer button lets you pick A4 or a thermal receipt size.');
  const draftB = await box(page.getByRole('button', { name: 'Save Draft' }));
  const cb = await box(page.getByRole('button', { name: 'Create Sale' }));
  await ov('box', draftB, 'park for later', { pos: 'above', pad: 4 });
  await ov('box', cb, null, { pad: 5, delay: 600, color: '#2563eb' });
  await wait(4200);
  await clear();
  await click(page.getByRole('button', { name: 'Create Sale' }), { after: 2200 });

  // ── 13. print prompt ───────────────────────────────────────────────────
  await say(13, 'Done — print the invoice',
    'The sale gets its number, stock is reduced and payments are recorded. Print the invoice now, or skip — you can always print it later from the sale. The screen is already clear for the next customer.');
  const dlg = page.getByText('Print the invoice now?').locator('xpath=ancestor::div[contains(@class,"bg-white")][1]');
  await dlg.waitFor();
  await ov('box', await box(dlg), 'sale saved!', { pos: 'above', pad: 6, color: '#059669' });
  await wait(voice ? 2500 : 6500);
  await clear();
  // Dismiss the prompt without opening a print window.
  await click(page.getByRole('button', { name: 'No, thanks' }), { after: 900 });

  // ── 14. find it again ──────────────────────────────────────────────────
  await say(14, 'Find it in the sales list', 'Every sale appears under <b>Sales → Sales list</b>, where you can open, reprint, duplicate or return it.');
  await page.goto(BASE + '/sales/list', { waitUntil: 'load' });
  await page.waitForSelector('tbody tr');
  await page.evaluate(() => { __ov.ensure(); });
  await caption(14, 'Find it in the sales list', 'Every sale appears under <b>Sales → Sales list</b>, where you can open, reprint, duplicate or return it.');
  await wait(1500);
  const firstRow = page.locator('tbody tr').first();
  if (await firstRow.count()) {
    await ov('box', await box(firstRow), 'the sale we just made', { pos: 'below', pad: 4 });
  }
  await wait(5000);
  await clear();
  await ov('hideCaption');

  // ── outro ──────────────────────────────────────────────────────────────
  await ov('showCursor', false);
  await card('recap', cardHtml('Recap', 'A sale in five steps',
    '', `<ol><li>Sales → New Sale</li><li>Search &amp; pick the customer (or walk-in)</li><li>Add products, adjust qty / price / discount</li><li>Check totals, split the payment</li><li>Create Sale → print the invoice</li></ol><div class="hand">That's it — happy selling!</div>`));
  await narrate('outro');
  await wait(voice ? 1500 : 7500);
  await holdVoice();
  if (voice) await wait(1200);

  await cdp.send('Page.stopScreencast');
  const end = Date.now() / 1000;
  // ffmpeg concat list: each frame lasts until the next one arrived.
  const lines = [];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(frameDir, 'list.txt'), lines.join('\n'));
  console.log('frames', frames.length, 'seconds', (end - frames[0].t).toFixed(1));
  await browser.close();

  // Each voice clip is delayed to the moment its caption appeared, then all
  // are mixed into one track (clips never overlap; see narrate()).
  // A cue without a file is a timing-only estimate (narrate.py --estimate):
  // it paced the scenes but adds no sound.
  const spoken = cues.filter((c) => c.file);
  const audioArgs = [];
  if (spoken.length) {
    const cues = spoken;
    const t0 = frames[0].t;
    cues.forEach((c) => audioArgs.push('-i', c.file));
    const delays = cues.map((c, i) => {
      const ms = Math.max(0, Math.round((c.t - t0) * 1000));
      return `[${i + 1}:a]adelay=${ms}:all=1[v${i}]`;
    });
    const mix = cues.map((_, i) => `[v${i}]`).join('') + `amix=inputs=${cues.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`;
    audioArgs.push('-filter_complex', [...delays, mix].join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
  }
  execFileSync(process.env.FFMPEG || 'ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frameDir, 'list.txt'),
    ...audioArgs,
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', OUT,
  ], { stdio: 'inherit' });
  fs.rmSync(frameDir, { recursive: true, force: true });
  console.log('wrote', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
