// Purchase entry: one purchase from a supplier on Record Purchase, from the
// purchase list to the posted purchase. Scenes only; lib/recorder.js does the rest.
module.exports = {
  warm: ['/purchases/list', '/purchases/new'],
  start: '/purchases',
  async run({ page, W, voice, wait, ov, box, union, click, type, say, clear, narrate, holdVoice, cardHtml, card }) {
    // ── 0. title card ──────────────────────────────────────────────────────
    await card('title', cardHtml('ERP71 · Purchase',
      'How purchase entry works',
      'Record stock you bought from a supplier — supplier, products, costs, freight and payment — on one screen.',
      `<ol><li>Open Record Purchase</li><li>Pick the supplier</li><li>Add products at cost</li><li>Add freight &amp; check the total</li><li>Pay now or owe the supplier, then post</li></ol>`));
    await narrate('intro');
    await wait(6500);
    await holdVoice();
    await ov('card', null);
    await wait(700);

    // ── 1. getting there ───────────────────────────────────────────────────
    await ov('showCursor', true);
    await say(1, 'Open the Record Purchase screen', 'In the sidebar open <b>Purchase → Purchases</b>, then click <b>Record Purchase</b> at the top right.');
    const listLink = page.locator('aside a[href="/purchases/list"]:visible, nav a[href="/purchases/list"]:visible').first();
    await ov('box', await box(listLink), 'Purchase list', { pos: 'right', pad: 4 });
    await wait(1500);
    await click(listLink, { after: 0 });
    await page.waitForURL('**/purchases/list');
    await page.waitForLoadState('networkidle');
    await ov('clear');
    const recordBtn = page.locator('a:visible, button:visible', { hasText: 'Record Purchase' }).first();
    await ov('box', await box(recordBtn), 'record a new purchase', { pos: 'below', pad: 5 });
    await wait(1800);
    await click(recordBtn, { after: 0 });
    await page.waitForURL('**/purchases/new');
    await page.waitForSelector('text=No items yet');
    await wait(900);
    await clear();

    // ── 2. screen tour ─────────────────────────────────────────────────────
    const supplierInput = page.locator('input[placeholder^="Supplier"]');
    const meta = await box(page.locator('h1', { hasText: 'Record Purchase' }).locator('xpath=ancestor::div[contains(@class,"border-b")][1]'));
    const leftTop = await box(supplierInput);
    const totalLbl = await box(page.getByText('Subtotal', { exact: true }));
    const postBtn = await box(page.getByRole('button', { name: 'Post Purchase' }));

    await say(2, 'One screen, three areas', 'Everything for the purchase lives on this page — the same layout as a sale.');
    await ov('box', { x: meta.x + 4, y: meta.y + 4, w: meta.w - 8, h: meta.h - 8 }, 'A · purchase details', { pos: 'below', pad: 2, dx: -300 });
    await wait(1600);
    const leftArea = { x: leftTop.x, y: leftTop.y - 22, w: (totalLbl.x - 24) - leftTop.x, h: 860 - leftTop.y };
    await ov('box', leftArea, 'B · who you bought from & what', { pos: 'above', pad: 4, dy: 330 });
    await wait(1600);
    const panel = { x: totalLbl.x - 4, y: totalLbl.y - 10, w: W - totalLbl.x - 8, h: postBtn.y + postBtn.h - totalLbl.y + 14 };
    await ov('box', panel, 'C · totals & payment', { pos: 'above', pad: 4, dy: 470 });
    await wait(3200);
    await clear();

    // ── 3. purchase details ────────────────────────────────────────────────
    await say(3, 'A · Purchase details',
      '<b>Purchase #</b> is numbered automatically. <b>Warehouse</b> is where the goods arrive. Tick <b>Per-line warehouse</b> to send different lines to different warehouses.');
    const pn = await box(page.getByText('Purchase #', { exact: false }).first());
    await ov('box', { ...pn, w: pn.w + 50 }, 'auto', { pos: 'below', pad: 5 });
    await wait(900);
    const wh = await box(page.locator('select[aria-label="Warehouse"]').first());
    await ov('box', wh, 'stock arrives here', { pos: 'below', pad: 5 });
    await wait(900);
    const perLine = await box(page.getByText(/per-line warehouse/i).first());
    await ov('box', union(perLine, { ...perLine, x: perLine.x - 20 }), 'split by line', { pos: 'below', pad: 5, dx: -20 });
    await wait(4200);
    await clear();

    // ── 4. supplier ────────────────────────────────────────────────────────
    await say(4, 'B · Pick the supplier',
      'Search by <b>name or phone</b>. The card shows their phone, address and <b>payable</b> — what you already owe them. Use <b>+</b> to add a new supplier on the spot.');
    await type(supplierInput, 'Bengal', { after: 1400 });
    await click(page.getByText('Bengal Grains Ltd.').last(), { after: 1200 });
    const supCard = await box(page.getByText('Gopalganj').locator('xpath=ancestor::div[2]'));
    await ov('box', supCard, 'phone · payable · address', { pos: 'below', pad: 6 });
    const plus = await box(page.getByRole('button', { name: /new supplier/i }));
    await ov('box', plus, '+ new supplier', { pos: 'above', pad: 4, delay: 700 });
    await wait(5200);
    await clear();

    // ── 5. first product ───────────────────────────────────────────────────
    const product = page.locator('input[aria-label="Product"]');
    const cost = page.locator('input[aria-label="Unit Cost"]');
    const qty = page.locator('input[aria-label="Qty"]');
    await say(5, 'Add products',
      'Type part of a product name or SKU and press <b>Enter</b> to pick it. The list shows how much is <b>in stock</b> right now.');
    await type(product, 'Basmati', { after: 1500 });
    const dd = await box(page.getByText('SKU: GRN-001').locator('xpath=ancestor::*[self::li or self::button or self::div][2]'));
    await ov('box', dd, 'stock on hand', { pos: 'right', pad: 4 });
    await wait(2600);
    await ov('clear');
    await product.press('Enter');
    await wait(900);

    // ── 6. cost ────────────────────────────────────────────────────────────
    await say(6, 'Enter what the supplier charged',
      '<b>Unit Cost</b> starts at the product’s <b>selling price</b> — always change it to the supplier’s rate. <b>Previous purchase rates</b> underneath show what you paid last time.');
    await ov('box', await box(cost), 'selling price!', { pos: 'above', pad: 4, dy: -4 });
    await wait(1400);
    const hist = await box(page.getByText('Previous purchase rates', { exact: false }).first().locator('xpath=ancestor::div[2]'));
    await ov('box', hist, 'what you paid before', { pos: 'below', pad: 4, dy: 18, delay: 400 });
    await wait(3000);
    await ov('clear');
    await type(cost, '88', { clear: true, after: 700 });
    await type(qty, '50', { clear: true, after: 700 });
    await click(page.getByRole('button', { name: 'Add', exact: true }), { after: 1400 });
    await clear();

    // ── 7. more products ───────────────────────────────────────────────────
    await say(7, 'Keep adding lines', 'For each product: pick it, type the cost and the quantity, and press <b>Enter</b>.');
    const addLine = async (term, c, q) => {
      await type(product, term, { after: 1100, delay: 90 });
      await product.press('Enter');
      await wait(700);
      await type(cost, c, { clear: true, after: 300, delay: 90 });
      await type(qty, q, { clear: true, after: 400, delay: 90 });
      await qty.press('Enter');
      await wait(1100);
    };
    await addLine('Lentils', '48', '40');
    await addLine('Chickpeas', '58', '30');
    await wait(800);

    // ── 8. line items ──────────────────────────────────────────────────────
    await say(8, 'Review and edit the lines',
      '<b>In Stock</b> is what you have <i>before</i> this purchase. Cost and quantity can be edited right in the table; the line total follows.');
    const tbl = await box(page.locator('table').first());
    await ov('box', { ...tbl, h: Math.min(tbl.h, 170) }, null, { pad: 4 });
    const inStock = await box(page.locator('th', { hasText: /in stock/i }).first());
    await ov('label', 'before this purchase', inStock.x - 60, inStock.y - 40, { delay: 900 });
    await wait(1800);
    const cq = page.locator('input[aria-label^="Qty — Chickpeas"]');
    await type(cq, '36', { clear: true, after: 900 });
    const dr = await box(cq);
    await ov('arrow', dr.x - 120, dr.y + 90, dr.x - 4, dr.y + dr.h - 2);
    await ov('label', 'changed 30 → 36', dr.x - 320, dr.y + 92);
    await wait(4000);
    await clear();

    // ── 9. totals ──────────────────────────────────────────────────────────
    await say(9, 'C · Freight, tax and discount',
      'Add the supplier’s <b>freight</b> (delivery charge), any <b>tax</b> on the bill, and a <b>discount</b> they gave you. The <b>Purchase Total</b> updates as you type.');
    const freight = page.locator('input[aria-label="Freight"]');
    await type(freight, '200', { clear: true, after: 900 });
    const frRow = await box(freight.locator('xpath=..'));
    const totalRow = await box(page.getByText('Purchase Total', { exact: true }).first().locator('xpath=..'));
    await ov('box', frRow, 'delivery charge', { pos: 'left', pad: 4 });
    await ov('box', totalRow, null, { pad: 6, delay: 800, color: '#2563eb' });
    await ov('label', 'live total', totalRow.x + 4, totalRow.y + totalRow.h + 14, { color: '#2563eb', delay: 1300 });
    await wait(5000);
    await clear();

    // ── 10. payment ────────────────────────────────────────────────────────
    await say(10, 'Pay now, or owe the supplier',
      'Enter what you paid, by method. Here we pay <b>৳5,000 in cash</b>; the rest stays as <b>supplier due</b> on their account. Settle it later from <b>Purchase → Supplier Payment</b>.');
    await type('input[aria-label="Cash amount"]', '5000', { clear: true, after: 1200 });
    const due = await box(page.getByText(/^Supplier due/).first());
    await ov('box', due, 'you still owe this', { pos: 'below', pad: 5 });
    await wait(5000);
    await clear();

    // ── 11. note ───────────────────────────────────────────────────────────
    await say(11, 'Add a note (optional)', 'A good place for the <b>supplier’s invoice or challan number</b>, so you can match the paperwork later.');
    await type('input[aria-label="Notes"]', 'Supplier invoice BG-2291', { after: 1500, delay: 70 });

    // ── 12. post ───────────────────────────────────────────────────────────
    await say(12, 'Post it',
      '<b>Post Purchase</b> adds the stock, records the payment and the amount owed, and posts the accounting entry.');
    const pb = await box(page.getByRole('button', { name: 'Post Purchase' }));
    await ov('box', pb, null, { pad: 5, color: '#2563eb' });
    await wait(2500);
    await clear();
    await click(page.getByRole('button', { name: 'Post Purchase' }), { after: 0 });
    await page.waitForURL('**/purchases/list');
    await page.waitForSelector('tbody tr');

    // ── 13. result ─────────────────────────────────────────────────────────
    await say(13, 'Done — it’s in the purchase list',
      'You land back on the list with the new purchase on top. Its stock is already added, and the voucher column shows the accounting entry was <b>posted</b>.');
    await wait(1200);
    const firstRow = page.locator('tbody tr').first();
    await ov('box', await box(firstRow), 'the purchase we just made', { pos: 'below', pad: 4 });
    await wait(voice ? 2500 : 6500);
    await clear();
    await ov('hideCaption');

    // ── outro ──────────────────────────────────────────────────────────────
    await ov('showCursor', false);
    await card('recap', cardHtml('Recap', 'A purchase in five steps',
      '', `<ol><li>Purchase → Purchases → Record Purchase</li><li>Search &amp; pick the supplier</li><li>Add products with the supplier’s cost and qty</li><li>Add freight / tax / discount</li><li>Pay now or keep it due → Post Purchase</li></ol><div class="hand">Stock in, books updated!</div>`));
    await narrate('outro');
    await wait(voice ? 1500 : 7500);
    await holdVoice();
    if (voice) await wait(1200);
  },
};
