import { placeholderEmailFor } from '@erp71/shared-types';
import { isStrongMatch, linkMatchReasons, rankByMatch, unambiguousPairs } from './employee-link-match.util';

const card = (overrides: Partial<{ phone: string | null; email: string | null; name: string }> = {}) => ({
    phone: '01700100057',
    email: null,
    name: 'Karim Uddin',
    ...overrides,
});
const login = (overrides: Partial<{ mobile: string | null; email: string | null; name: string | null }> = {}) => ({
    mobile: null,
    email: 'someone@example.com',
    name: null,
    ...overrides,
});

describe('linkMatchReasons', () => {
    it('matches a local-format employee phone to the login\'s E.164 mobile', () => {
        expect(linkMatchReasons(card(), login({ mobile: '+8801700100057' }))).toEqual(['mobile']);
    });

    it('matches email regardless of case and surrounding space', () => {
        expect(
            linkMatchReasons(card({ email: ' Karim@Shop.com ' }), login({ email: 'karim@shop.com' })),
        ).toEqual(['email']);
    });

    it('never matches on a placeholder address, which belongs to no person', () => {
        const placeholder = placeholderEmailFor('emp-1');
        expect(linkMatchReasons(card({ email: placeholder }), login({ email: placeholder }))).toEqual([]);
    });

    it('matches a name with whitespace and case folded, as a weak reason only', () => {
        const reasons = linkMatchReasons(card({ name: 'Karim  Uddin' }), login({ name: 'karim uddin' }));
        expect(reasons).toEqual(['name']);
        expect(isStrongMatch(reasons)).toBe(false);
    });

    it('lists every reason that applies, strongest first', () => {
        expect(
            linkMatchReasons(
                card({ email: 'k@shop.com' }),
                login({ mobile: '+8801700100057', email: 'k@shop.com', name: 'Karim Uddin' }),
            ),
        ).toEqual(['mobile', 'email', 'name']);
    });

    it('ignores an employee phone that is not a mobile number', () => {
        expect(linkMatchReasons(card({ phone: 'n/a' }), login({ mobile: '+8801700100057' }))).toEqual([]);
    });
});

describe('rankByMatch', () => {
    it('puts strong matches first, then name-only, then the rest alphabetically', () => {
        const ranked = rankByMatch([
            { label: 'c', matches: [] },
            { label: 'b', matches: ['name' as const] },
            { label: 'z', matches: ['mobile' as const] },
            { label: 'a', matches: [] },
        ]);
        expect(ranked.map((row) => row.label)).toEqual(['z', 'b', 'a', 'c']);
    });
});

describe('unambiguousPairs', () => {
    const employees = [
        { id: 'e1', phone: '01700000001', email: null, name: 'One' },
        { id: 'e2', phone: '01700000002', email: null, name: 'Two' },
        { id: 'e3', phone: '01700000009', email: 'shared@x.com', name: 'Three' },
        { id: 'e4', phone: '01700000010', email: 'shared@x.com', name: 'Four' },
        { id: 'e5', phone: '01700000011', email: null, name: 'Same Name' },
    ];
    const users = [
        { id: 'u1', mobile: '+8801700000001', email: 'one@x.com', name: null },
        { id: 'u3', mobile: null, email: 'shared@x.com', name: null },
        { id: 'u5', mobile: null, email: 'five@x.com', name: 'Same Name' },
    ];

    const pairs = unambiguousPairs(employees, users, linkMatchReasons);

    it('offers a strong one-to-one pair', () => {
        expect(pairs).toContainEqual(expect.objectContaining({ employee: employees[0], user: users[0], matches: ['mobile'] }));
    });

    it('leaves out a login two cards both strongly match', () => {
        expect(pairs.some((pair) => pair.user.id === 'u3')).toBe(false);
    });

    it('never offers a pair on a name alone', () => {
        expect(pairs.some((pair) => pair.user.id === 'u5')).toBe(false);
    });

    it('leaves out a card nobody matches', () => {
        expect(pairs.some((pair) => pair.employee.id === 'e2')).toBe(false);
        expect(pairs).toHaveLength(1);
    });

    it('leaves out a card that strongly matches two logins', () => {
        const twoLogins = [
            { id: 'ua', mobile: '+8801700000001', email: null, name: null },
            { id: 'ub', mobile: null, email: 'one@x.com', name: null },
        ];
        const oneCard = [{ id: 'e1', phone: '01700000001', email: 'one@x.com', name: 'One' }];
        expect(unambiguousPairs(oneCard, twoLogins, linkMatchReasons)).toEqual([]);
    });
});
