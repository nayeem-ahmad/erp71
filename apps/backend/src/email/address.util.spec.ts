import { formatEmailAddress, parseEmailAddress } from './address.util';

describe('parseEmailAddress()', () => {
    it('reads a bare address as having no display name', () => {
        expect(parseEmailAddress('notify@erp71.com')).toEqual({ email: 'notify@erp71.com', name: null });
    });

    it('splits a "Name <addr>" header value', () => {
        expect(parseEmailAddress('Shop BD <hello@shop.com>')).toEqual({
            email: 'hello@shop.com',
            name: 'Shop BD',
        });
    });

    it('unquotes a quoted display name', () => {
        expect(parseEmailAddress('"Shop, BD" <hello@shop.com>')).toEqual({
            email: 'hello@shop.com',
            name: 'Shop, BD',
        });
    });

    it('tolerates a name-less angle-bracket form', () => {
        expect(parseEmailAddress('<hello@shop.com>')).toEqual({ email: 'hello@shop.com', name: null });
    });
});

describe('formatEmailAddress()', () => {
    it('returns the bare address when there is no name', () => {
        expect(formatEmailAddress('hello@shop.com', null)).toBe('hello@shop.com');
    });

    it('joins name and address', () => {
        expect(formatEmailAddress('hello@shop.com', 'Shop BD')).toBe('Shop BD <hello@shop.com>');
    });

    it('quotes a name containing a comma so the header stays one address', () => {
        expect(formatEmailAddress('hello@shop.com', 'Shop, BD')).toBe('"Shop, BD" <hello@shop.com>');
    });

    it('round-trips through the parser', () => {
        const formatted = formatEmailAddress('hello@shop.com', 'Shop, BD');
        expect(parseEmailAddress(formatted)).toEqual({ email: 'hello@shop.com', name: 'Shop, BD' });
    });
});
