import { deliveryPrefill } from './DeliveryAddressFields';

describe('deliveryPrefill', () => {
    it('reuses where the last order went', () => {
        expect(
            deliveryPrefill({
                address: 'Typed by staff',
                last_delivery: { address: 'House 5, Road 2', area: 'Dhanmondi' },
            }),
        ).toEqual({ address: 'House 5, Road 2', area: 'Dhanmondi' });
    });

    it('falls back to the address on the shop\'s record, with no area', () => {
        expect(deliveryPrefill({ address: 'House 9, Mirpur', last_delivery: null })).toEqual({
            address: 'House 9, Mirpur',
            area: '',
        });
    });

    it('is empty for a guest or a shopper with nothing on file', () => {
        expect(deliveryPrefill(null)).toEqual({ address: '', area: '' });
        expect(deliveryPrefill({ address: null })).toEqual({ address: '', area: '' });
    });
});
