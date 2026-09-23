// Customer payment: a customer who bought on credit pays part of what they
// owe. Scenes only; lib/recorder.js does the rest.
const { findByName } = require('../lib/api');

const CUSTOMER = 'Karim Hossain';

module.exports = {
  warm: ['/sales/customer-payments'],
  start: '/sales',

  // Karim buys ৳2,050 on credit and pays ৳500, so he owes ৳1,550: a real sale
  // through the real endpoint, so his due balance is the app's own figure.
  async setup(api) {
    const customer = await findByName(api, '/customers', CUSTOMER);
    await api.patch(`/customers/${customer.id}`, { credit_limit: 20000, credit_enabled: true });
    const products = await api.get('/products');
    const list = Array.isArray(products) ? products : products.items || products.data;
    const id = (name) => list.find((p) => p.name.startsWith(name)).id;
    await api.post('/sales', {
      storeId: api.storeId,
      customerId: customer.id,
      items: [
        { productId: id('Basmati'), quantity: 10, priceAtSale: 110 },
        { productId: id('Sunflower'), quantity: 5, priceAtSale: 190 },
      ],
      totalAmount: 2050,
      amountPaid: 500,
      payments: [{ paymentMethod: 'CASH', amount: 500 }],
    });
  },

  async run({ page, voice, wait, ov, box, click, type, say, clear, narrate, holdVoice, cardHtml, card }) {
    // ── 0. title card ──────────────────────────────────────────────────────
    await card('title', cardHtml('ERP71 · Sales',
      'How to receive a customer payment',
      'A customer who bought on credit comes back to pay. Record it, and their due balance goes down.',
      `<ol><li>Open Customer Payment</li><li>New Customer Payment</li><li>Pick the customer, see what they owe</li><li>Enter the amount</li><li>Record the receipt</li></ol>`));
    await narrate('intro');
    await wait(6500);
    await holdVoice();
    await ov('card', null);
    await wait(700);

    // ── 1. getting there ───────────────────────────────────────────────────
    await ov('showCursor', true);
    await say(1, 'Open Customer Payment', 'In the sidebar open <b>Sales → Customer Payment</b>.');
    const link = page.locator('aside a[href="/sales/customer-payments"]:visible, nav a[href="/sales/customer-payments"]:visible').first();
    await ov('box', await box(link), 'here', { pos: 'right', pad: 4 });
    await wait(1500);
    await click(link, { after: 0 });
    await page.waitForURL('**/sales/customer-payments');
    await page.waitForLoadState('networkidle');
    await wait(800);
    await clear();

    // ── 2. the list ────────────────────────────────────────────────────────
    await say(2, 'Every payment in one list',
      'Money received from customers — and anything paid back to them — is listed here. Filter by date or customer; the card shows the total for the period.');
    await ov('box', await box(page.getByText('Net Total', { exact: true }).first().locator('xpath=ancestor::div[1]')), 'total for the period', { pos: 'below', pad: 6 });
    await wait(1200);
    const custFilter = page.locator('select', { has: page.locator('option', { hasText: 'All customers' }) }).first();
    await ov('box', await box(custFilter), 'one customer only', { pos: 'below', pad: 5, delay: 300 });
    await wait(4000);
    await clear();

    // ── 3. new payment ─────────────────────────────────────────────────────
    const newBtn = page.getByRole('button', { name: 'New Customer Payment' });
    await say(3, 'Start a new payment', 'Click <b>New Customer Payment</b>.');
    await ov('box', await box(newBtn), null, { pad: 5, color: '#2563eb' });
    await wait(1200);
    await click(newBtn, { after: 900 });
    const modal = page.locator('form', { hasText: 'New Customer Payment' });
    const [direction, customer] = [modal.locator('select').nth(0), modal.locator('select').nth(1)];
    await ov('clear');

    // ── 4. direction ───────────────────────────────────────────────────────
    await say(4, 'Receive, or pay back',
      '<b>Receive from customer</b> is money coming in. <b>Pay to customer</b> is for refunds, or paying back an advance they left with you.');
    await ov('box', await box(direction), 'money coming in', { pos: 'right', pad: 5 });
    await wait(4500);
    await clear();

    // ── 5. customer ────────────────────────────────────────────────────────
    await say(5, 'Pick the customer',
      'Choose who is paying. Their <b>due balance</b> — what they owe from earlier credit sales — appears right under it.');
    await click(customer, { after: 300 });
    const option = await customer.locator('option', { hasText: CUSTOMER }).first().getAttribute('value');
    await customer.selectOption(option);
    await wait(900);
    const dueBox = modal.getByText('Due balance', { exact: false }).first().locator('xpath=ancestor::div[1]');
    await ov('box', await box(dueBox), 'owes ৳1,550', { pos: 'right', pad: 5 });
    await wait(4500);
    await clear();

    // ── 6. amount ──────────────────────────────────────────────────────────
    await say(6, 'Enter the amount',
      'He pays <b>৳1,000</b> today. Paying part is fine — the rest stays due. Pay more than is owed, and the extra is kept as an <b>advance</b> for next time.');
    await type(modal.locator('input[type="number"]'), '1000', { after: 900 });
    await ov('box', await box(modal.getByText('excess becomes customer advance', { exact: false }).first()), 'overpaying? kept as advance', { pos: 'right', pad: 4 });
    await wait(1500);
    await type(modal.locator('textarea'), 'Paid at counter — rest next week', { after: 1200, delay: 60 });
    await ov('clear');

    // ── 7. record ──────────────────────────────────────────────────────────
    await say(7, 'Record the receipt',
      '<b>Record receipt</b> saves it, lowers the customer’s due balance, and posts the entry to your accounts.');
    const recordBtn = modal.getByRole('button', { name: 'Record receipt' });
    await ov('box', await box(recordBtn), null, { pad: 5, color: '#2563eb' });
    await wait(1800);
    await clear();
    await click(recordBtn, { after: 0 });
    await page.getByText('Transaction recorded successfully').first().waitFor();
    await wait(1000);

    // ── 8. result ──────────────────────────────────────────────────────────
    await say(8, 'It’s on the list',
      'The receipt appears with its own number. Use the icons on the row to view, edit, duplicate or print it.');
    const row = page.locator('tbody tr').first();
    await ov('box', await box(row), 'Karim · ৳1,000', { pos: 'below', pad: 4 });
    await wait(4500);
    await clear();

    // ── 9. balance ─────────────────────────────────────────────────────────
    await say(9, 'The due balance went down',
      'Open a new payment for the same customer and his due balance is now <b>৳550</b> — the ৳1,550 he owed, less today’s ৳1,000.');
    await click(newBtn, { after: 900 });
    await modal.locator('select').nth(1).selectOption(option);
    await wait(900);
    await ov('box', await box(modal.getByText('Due balance', { exact: false }).first().locator('xpath=ancestor::div[1]')), 'was ৳1,550', { pos: 'right', pad: 5 });
    await wait(voice ? 2500 : 5000);
    await clear();
    await click(modal.getByRole('button', { name: 'Cancel' }), { after: 600 });
    await ov('hideCaption');

    // ── outro ──────────────────────────────────────────────────────────────
    await ov('showCursor', false);
    await card('recap', cardHtml('Recap', 'A customer payment in five steps',
      '', `<ol><li>Sales → Customer Payment</li><li>New Customer Payment</li><li>Receive from customer · pick the customer</li><li>Enter the amount (part is fine)</li><li>Record receipt → due balance goes down</li></ol><div class="hand">Money in, balance down!</div>`));
    await narrate('outro');
    await wait(voice ? 1500 : 7500);
    await holdVoice();
    if (voice) await wait(1200);
  },
};
