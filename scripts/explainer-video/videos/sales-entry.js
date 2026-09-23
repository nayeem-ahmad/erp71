// Sales entry: one complete sale on New Sale, from the sales list to the
// print prompt and back. Scenes only; lib/recorder.js does the rest.
module.exports = {
  warm: ['/sales/list', '/sales/new'],
  start: '/sales',
  async run({ page, BASE, W, voice, wait, ov, caption, box, union, click, type, narrate, holdVoice, say, clear, cardHtml, card }) {
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
  },
};
