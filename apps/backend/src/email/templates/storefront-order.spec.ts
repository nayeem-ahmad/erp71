import { renderStorefrontOrderEmail, renderStorefrontOrderSms } from './storefront-order';

const base = {
    orderId: 'clorder0000000000abcd1234',
    customerName: 'Rahim',
    storeName: 'Rahim & Sons <Fashion>',
    totalAmount: 1250,
    items: [{ name: 'Shirt <XL>', quantity: 2, unitPrice: 625 }],
    deliveryAddress: 'House 5, Road 2',
    deliveryArea: 'Dhanmondi',
    accountLink: 'https://app.erp71.com/store/rahim/account',
};

describe('renderStorefrontOrderEmail', () => {
    it('names the order by its short reference and the shop', () => {
        const { subject, html } = renderStorefrontOrderEmail({ ...base, event: 'PLACED' });

        expect(subject).toBe('We have your order — order #ABCD1234 at Rahim & Sons <Fashion>');
        expect(html).toContain('Order #ABCD1234');
        expect(html).toContain('House 5, Road 2, Dhanmondi');
        expect(html).toContain('https://app.erp71.com/store/rahim/account');
    });

    it('escapes shop- and shopper-supplied text in the body', () => {
        const { html } = renderStorefrontOrderEmail({ ...base, event: 'SHIPPED' });

        expect(html).toContain('Rahim &amp; Sons &lt;Fashion&gt;');
        expect(html).toContain('Shirt &lt;XL&gt;');
        expect(html).not.toContain('<XL>');
    });

    it('says what each status means', () => {
        expect(renderStorefrontOrderEmail({ ...base, event: 'CANCELLED' }).subject).toMatch(/^Your order has been cancelled/);
        expect(renderStorefrontOrderEmail({ ...base, event: 'DELIVERED' }).subject).toMatch(/^Your order has been delivered/);
    });

    it('leaves out the address and link when there are none', () => {
        const { html } = renderStorefrontOrderEmail({
            ...base,
            event: 'CONFIRMED',
            deliveryAddress: null,
            deliveryArea: null,
            accountLink: null,
        });

        expect(html).not.toContain('Delivery address');
        expect(html).not.toContain('View your orders');
    });
});

describe('renderStorefrontOrderSms', () => {
    it('fits the status, reference and amount into one line', () => {
        expect(renderStorefrontOrderSms({ ...base, event: 'SHIPPED' })).toBe(
            'Dear Rahim, your order #ABCD1234 (BDT 1250.00) is on its way. - Rahim & Sons <Fashion>',
        );
    });

    it('clips a long name so it cannot add a segment by itself', () => {
        const sms = renderStorefrontOrderSms({ ...base, event: 'CONFIRMED', customerName: 'A'.repeat(60) });
        expect(sms).toContain(`Dear ${'A'.repeat(20)},`);
    });
});
