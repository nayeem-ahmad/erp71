// Supplier payment: pay a supplier part of what you owe and match it to their
// open bills. Scenes only; lib/recorder.js does the rest.
const SUPPLIER = 'Meghna Traders';

module.exports = {
  warm: ['/purchases/supplier-payments'],
  start: '/purchases',

  // Two purchases from a new supplier: ৳6,320 with ৳3,000 paid on the spot,
  // and ৳4,800 unpaid, so the payable (৳8,120) and the open bills agree.
  async setup(api) {
    const supplier = await api.post('/suppliers', { name: SUPPLIER, phone: '01711223344', address: 'Moulvibazar, Dhaka' });
    const products = await api.get('/products');
    const list = Array.isArray(products) ? products : products.items || products.data;
    const id = (name) => list.find((p) => p.name.startsWith(name)).id;
    await api.post('/purchases', {
      storeId: api.storeId,
      supplierId: supplier.id,
      items: [{ productId: id('Basmati'), quantity: 50, unitCost: 88 }, { productId: id('Lentils'), quantity: 40, unitCost: 48 }],
      payments: [{ paymentMethod: 'CASH', amount: 3000 }],
    });
    await api.post('/purchases', {
      storeId: api.storeId,
      supplierId: supplier.id,
      items: [{ productId: id('Sunflower'), quantity: 30, unitCost: 160 }],
    });
  },

  async run({ page, voice, wait, ov, box, click, type, say, clear, narrate, holdVoice, cardHtml, card }) {
    // ── 0. title card ──────────────────────────────────────────────────────
    await card('title', cardHtml('ERP71 · Purchase',
      'How to pay a supplier',
      'Pay what you owe a supplier — all of it or part — and match the payment to their bills.',
      `<ol><li>Open Supplier Payment</li><li>New Supplier Payment</li><li>Pick the supplier, see what you owe</li><li>Enter the amount, split it across bills</li><li>Record the payment</li></ol>`));
    await narrate('intro');
    await wait(6500);
    await holdVoice();
    await ov('card', null);
    await wait(700);

    // ── 1. getting there ───────────────────────────────────────────────────
    await ov('showCursor', true);
    await say(1, 'Open Supplier Payment', 'In the sidebar open <b>Purchase → Supplier Payment</b>.');
    const link = page.locator('aside a[href="/purchases/supplier-payments"]:visible, nav a[href="/purchases/supplier-payments"]:visible').first();
    await ov('box', await box(link), 'here', { pos: 'right', pad: 4 });
    await wait(1500);
    await click(link, { after: 0 });
    await page.waitForURL('**/purchases/supplier-payments');
    await page.waitForSelector('tbody tr');
    await wait(800);
    await clear();

    // ── 2. the list ────────────────────────────────────────────────────────
    await say(2, 'Every payment in one list',
      'Money you paid suppliers is listed here — including payments made on the purchase itself, like this one.');
    await ov('box', await box(page.locator('tbody tr').first()), 'paid when the purchase was posted', { pos: 'below', pad: 4 });
    await wait(4500);
    await clear();

    // ── 3. new payment ─────────────────────────────────────────────────────
    const newBtn = page.getByRole('button', { name: 'New Supplier Payment' });
    await say(3, 'Start a new payment',
      'Click <b>New Supplier Payment</b>. The direction is already <b>Pay to supplier</b>; <b>Receive from supplier</b> is for a refund they send you.');
    await ov('box', await box(newBtn), null, { pad: 5, color: '#2563eb' });
    await wait(1200);
    await click(newBtn, { after: 900 });
    await ov('captionAt', 'side');
    const modal = page.locator('form', { hasText: 'New Supplier Payment' });
    const [direction, supplier] = [modal.locator('select').nth(0), modal.locator('select').nth(1)];
    await ov('box', await box(direction), 'money going out', { pos: 'right', pad: 5 });
    await wait(3500);
    await clear();

    // ── 4. supplier ────────────────────────────────────────────────────────
    await say(4, 'Pick the supplier',
      'Choose who you are paying. The <b>payable balance</b> is everything you owe them, and their <b>open bills</b> are listed below with what is still due on each.');
    await click(supplier, { after: 300 });
    const option = await supplier.locator('option', { hasText: SUPPLIER }).first().getAttribute('value');
    await supplier.selectOption(option);
    await modal.getByText('PUR-00008').first().waitFor();
    await wait(900);
    await ov('box', await box(modal.getByText('Payable balance', { exact: false }).first().locator('xpath=ancestor::div[1]')), 'you owe ৳8,120', { pos: 'right', pad: 5 });
    await wait(1200);
    const bills = modal.getByText('PUR-00007').first().locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await ov('box', await box(bills), 'unpaid bills', { pos: 'right', pad: 5, delay: 300 });
    await wait(4500);
    await clear();

    // ── 5. amount and allocation ───────────────────────────────────────────
    await say(5, 'Enter the amount, split it across bills',
      'We pay <b>৳5,000</b>. Clear the older bill first — <b>৳3,320</b> on PUR-00007 — and put the other <b>৳1,680</b> against PUR-00008. The line underneath counts down to zero.');
    await type(modal.locator('input[placeholder]:not([placeholder="0.00"])[type="number"]').first(), '5000', { after: 800 });
    const billInput = (n) => modal.getByText(n).first().locator('xpath=..').locator('input');
    await type(billInput('PUR-00007'), '3320', { after: 600 });
    await type(billInput('PUR-00008'), '1680', { after: 900 });
    const remaining = modal.getByText(/remaining|allocate/i).last();
    await ov('box', await box(remaining), 'all ৳5,000 matched', { pos: 'right', pad: 4 });
    await wait(1500);
    await type(modal.locator('textarea'), 'Bank transfer, ref BT-4471', { after: 1200, delay: 60 });
    await ov('clear');

    // ── 6. record ──────────────────────────────────────────────────────────
    await say(6, 'Record the payment',
      '<b>Record payment</b> saves it, lowers what you owe, marks the bills paid or part-paid, and posts the entry to your accounts. Anything you leave unallocated stays on account as a <b>prepayment</b>.');
    const recordBtn = modal.getByRole('button', { name: 'Record payment' });
    await ov('box', await box(recordBtn), null, { pad: 5, color: '#2563eb' });
    await wait(2000);
    await clear();
    await click(recordBtn, { after: 0 });
    await page.getByText('Transaction recorded successfully').first().waitFor();
    await ov('captionAt', 'bottom');
    await wait(1000);

    // ── 7. result ──────────────────────────────────────────────────────────
    await say(7, 'It’s on the list', 'The new payment is on top with its own number, ready to view, edit or print.');
    await ov('box', await box(page.locator('tbody tr').first()), 'Meghna Traders · ৳5,000', { pos: 'below', pad: 4 });
    await wait(4000);
    await clear();

    // ── 8. balance ─────────────────────────────────────────────────────────
    await say(8, 'What you owe went down',
      'Open a new payment for the same supplier: the payable is now <b>৳3,120</b>, PUR-00007 is gone from the open bills, and only the rest of PUR-00008 is left.');
    await click(newBtn, { after: 900 });
    await ov('captionAt', 'side');
    await modal.locator('select').nth(1).selectOption(option);
    await modal.getByText('PUR-00008').first().waitFor();
    await wait(900);
    await ov('box', await box(modal.getByText('Payable balance', { exact: false }).first().locator('xpath=ancestor::div[1]')), 'was ৳8,120', { pos: 'right', pad: 5 });
    await ov('box', await box(modal.getByText('PUR-00008').first().locator('xpath=..')), 'only this is left', { pos: 'right', pad: 4, delay: 700 });
    await wait(voice ? 2500 : 5000);
    await clear();
    await click(modal.getByRole('button', { name: 'Cancel' }), { after: 600 });
    await ov('hideCaption');
    await ov('captionAt', 'bottom');

    // ── outro ──────────────────────────────────────────────────────────────
    await ov('showCursor', false);
    await card('recap', cardHtml('Recap', 'A supplier payment in five steps',
      '', `<ol><li>Purchase → Supplier Payment</li><li>New Supplier Payment</li><li>Pick the supplier, check the open bills</li><li>Enter the amount, split it across bills</li><li>Record payment → payable goes down</li></ol><div class="hand">Bills paid, books straight!</div>`));
    await narrate('outro');
    await wait(voice ? 1500 : 7500);
    await holdVoice();
    if (voice) await wait(1200);
  },
};
