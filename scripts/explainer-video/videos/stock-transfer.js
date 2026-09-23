// Stock transfer: send stock from one warehouse to another, then receive it —
// part now, the rest later. Scenes only; lib/recorder.js does the rest.
const SOURCE = 'Gulshan Branch Main Warehouse';
const DEST = 'Gulshan Back Storage';
const OTHER_BRANCH = 'Banani Branch Main Warehouse';

module.exports = {
  warm: ['/inventory/transfers'],
  start: '/inventory',

  async run({ page, voice, wait, ov, box, union, click, type, say, clear, narrate, holdVoice, cardHtml, card }) {
    const form = page.locator('form', { hasText: 'New Transfer' });
    const sel = (i) => form.locator('select').nth(i);
    const pick = async (select, text) => {
      await click(select, { after: 300 });
      const value = await select.locator('option', { hasText: text }).first().getAttribute('value');
      await select.selectOption(value);
      await wait(700);
    };

    // ── 0. title card ──────────────────────────────────────────────────────
    await card('title', cardHtml('ERP71 · Inventory',
      'How to transfer stock',
      'Move stock from one warehouse to another — send it now, and receive it when it actually arrives.',
      `<ol><li>Open Transfers</li><li>Choose from and to</li><li>Add the products</li><li>Create the transfer</li><li>Receive it at the other end</li></ol>`));
    await narrate('intro');
    await wait(6500);
    await holdVoice();
    await ov('card', null);
    await wait(700);

    // ── 1. getting there ───────────────────────────────────────────────────
    await ov('showCursor', true);
    await say(1, 'Open Transfers', 'In the sidebar open <b>Inventory → Transfers</b>.');
    const link = page.locator('aside a[href="/inventory/transfers"]:visible, nav a[href="/inventory/transfers"]:visible').first();
    await ov('box', await box(link), 'here', { pos: 'right', pad: 4 });
    await wait(1500);
    await click(link, { after: 0 });
    await page.waitForURL('**/inventory/transfers');
    await form.waitFor();
    await wait(800);
    await clear();

    // ── 2. the page ────────────────────────────────────────────────────────
    await say(2, 'Create on top, track below',
      'The <b>New Transfer</b> form is at the top. Every transfer — and where it stands — is listed underneath.');
    await ov('box', await box(form), 'new transfer', { pos: 'right', pad: 4, dx: -170, dy: -150 });
    await wait(4500);
    await clear();

    // ── 3. from / to ───────────────────────────────────────────────────────
    await say(3, 'Where from, and where to',
      'Pick the <b>source</b> warehouse the stock leaves, and the <b>destination</b> it goes to. Between two <b>branches</b>, a transfer waits for approval before any stock moves.');
    await pick(sel(0), SOURCE);
    await pick(sel(1), OTHER_BRANCH);
    const notice = form.getByText('crosses branches', { exact: false }).first();
    await ov('box', await box(notice), 'another branch → needs approval', { pos: 'below', pad: 4 });
    await wait(3500);
    await ov('clear');
    await pick(sel(1), DEST);
    await ov('box', union(await box(sel(0)), await box(sel(1))), 'same branch → goes straight out', { pos: 'below', pad: 5 });
    await wait(2500);
    await clear();

    // ── 4. status and note ─────────────────────────────────────────────────
    await say(4, 'Send now, or save a draft',
      '<b>Send Now</b> takes the stock out of the source straight away. <b>Save as Draft</b> keeps it as a plan you can send later. Add a note for whoever unloads it.');
    await ov('box', await box(sel(2)), 'send now', { pos: 'below', pad: 5 });
    await wait(1500);
    await type(form.locator('input[placeholder="Optional"]'), 'Weekend shelf restock', { after: 1500, delay: 60 });
    await clear();

    // ── 5. products ────────────────────────────────────────────────────────
    await say(5, 'Add the products',
      'Choose a product and the quantity. <b>Add Line</b> for each more product; <b>Remove</b> takes a line out.');
    await pick(sel(3), 'Basmati Rice');
    await type(form.locator('input[type="number"]').nth(0), '20', { clear: true, after: 600 });
    await click(form.getByRole('button', { name: 'Add Line' }), { after: 600 });
    await pick(sel(4), 'Lentils');
    await type(form.locator('input[type="number"]').nth(1), '10', { clear: true, after: 900 });
    const lines = union(await box(sel(3)), await box(form.getByRole('button', { name: 'Remove' }).nth(1)));
    await ov('box', lines, '20 rice · 10 lentils', { pos: 'below', pad: 5, dy: 34 });
    await wait(3000);
    await clear();

    // ── 6. create ──────────────────────────────────────────────────────────
    await say(6, 'Create the transfer',
      'Click <b>Create Transfer</b>. It gets a number and shows as <b>Sent</b>: the stock has left the source and is <b>in transit</b> until someone receives it.');
    const createBtn = form.getByRole('button', { name: 'Create Transfer' });
    await ov('box', await box(createBtn), null, { pad: 5, color: '#2563eb' });
    await wait(1200);
    await click(createBtn, { after: 0 });
    await page.getByText('Transfer created.').first().waitFor();
    await page.locator('tbody tr').first().waitFor();
    await wait(900);
    await ov('clear');
    const row = page.locator('tbody tr').first();
    await ov('box', await box(row), 'Sent · 30 units outstanding', { pos: 'below', pad: 4 });
    await wait(voice ? 2500 : 4500);
    await clear();

    // ── 7. open it ─────────────────────────────────────────────────────────
    await say(7, 'Receive it when it arrives',
      'At the destination, open the transfer with <b>View</b>. Each line shows what was sent, what has arrived, and what is still outstanding.');
    await click(row.getByRole('link', { name: 'View' }), { after: 0 });
    await page.waitForURL('**/inventory/transfers/*');
    await page.getByText('Transfer Lines').first().waitFor();
    await wait(900);
    const linesCard = page.getByText('Transfer Lines').first().locator('xpath=ancestor::div[1]');
    await ov('box', await box(linesCard), 'sent · received · outstanding', { pos: 'below', pad: 4 });
    await wait(3500);
    await clear();

    // ── 8. partial receipt ─────────────────────────────────────────────────
    const qtyIn = page.locator('main input[type="number"]');
    const receive = page.getByRole('button', { name: /Receive Stock/ });
    await say(8, 'Receive what actually came',
      'Count what arrived. All 20 bags of rice came, but only <b>8</b> of the 10 lentils — so type 8 and click <b>Receive Stock</b>. The transfer becomes <b>partially received</b>.');
    await type(qtyIn.nth(1), '8', { clear: true, after: 900 });
    await ov('box', await box(qtyIn.nth(1)), '2 short', { pos: 'left', pad: 4 });
    await wait(1500);
    await ov('clear');
    await click(receive, { after: 0 });
    await page.getByText('Partially received').first().waitFor();
    await wait(900);
    await ov('box', await box(page.getByText('Partially received').first()), null, { pad: 5, color: '#d97706' });
    await ov('box', await box(page.getByText('Outstanding 2').first()), 'still on the way', { pos: 'below', pad: 4, delay: 500 });
    await wait(voice ? 2500 : 5000);
    await clear();

    // ── 9. the rest ────────────────────────────────────────────────────────
    await say(9, 'Receive the rest later',
      'When the last 2 arrive, receive them the same way. Once nothing is outstanding the transfer is <b>complete</b>, and the timeline shows every step.');
    await type(qtyIn.nth(1), '2', { clear: true, after: 700 });
    await click(receive, { after: 0 });
    await page.getByText('Outstanding 0').nth(1).waitFor();
    await wait(1000);
    const timeline = page.getByText('Transfer Timeline').first().locator('xpath=ancestor::div[1]');
    await ov('box', await box(timeline), 'every step, with times', { pos: 'below', pad: 4 });
    await wait(voice ? 2500 : 5000);
    await clear();
    await ov('hideCaption');

    // ── outro ──────────────────────────────────────────────────────────────
    await ov('showCursor', false);
    await card('recap', cardHtml('Recap', 'A stock transfer in five steps',
      '', `<ol><li>Inventory → Transfers</li><li>Source and destination (other branch = approval)</li><li>Add products and quantities</li><li>Create Transfer → stock is in transit</li><li>View → Receive Stock, part or all</li></ol><div class="hand">Stock where you need it!</div>`));
    await narrate('outro');
    await wait(voice ? 1500 : 7500);
    await holdVoice();
    if (voice) await wait(1200);
  },
};
