import { isPublicAddress, resolvePublicHost } from './public-address.util';

describe('isPublicAddress', () => {
    it.each(['8.8.8.8', '203.0.113.10', '2606:4700::1111'])('accepts %s', (address) => {
        expect(isPublicAddress(address)).toBe(true);
    });

    it.each([
        '127.0.0.1',
        '10.1.2.3',
        '172.18.0.2',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '0.0.0.0',
        '::1',
        'fd00::1',
        'fe80::1',
        '::ffff:127.0.0.1',
        'not-an-ip',
    ])('refuses %s', (address) => {
        expect(isPublicAddress(address)).toBe(false);
    });
});

describe('resolvePublicHost', () => {
    it('accepts a host whose every address is public', async () => {
        const resolve = jest.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
        await expect(resolvePublicHost('smtp.example.com', resolve as any)).resolves.toEqual({
            ok: true,
            addresses: ['203.0.113.10'],
        });
    });

    it('refuses a host with one private address among public ones', async () => {
        const resolve = jest.fn().mockResolvedValue([
            { address: '203.0.113.10', family: 4 },
            { address: '10.0.0.5', family: 4 },
        ]);
        await expect(resolvePublicHost('mixed.example.com', resolve as any)).resolves.toEqual({
            ok: false,
            addresses: [],
            reason: 'private',
            address: '10.0.0.5',
        });
    });

    it('checks an IP literal without a lookup', async () => {
        const resolve = jest.fn();
        await expect(resolvePublicHost('[::1]', resolve as any)).resolves.toMatchObject({ ok: false, reason: 'private' });
        expect(resolve).not.toHaveBeenCalled();
    });

    it('reports a name that does not resolve', async () => {
        const resolve = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
        await expect(resolvePublicHost('nope.invalid', resolve as any)).resolves.toEqual({
            ok: false,
            addresses: [],
            reason: 'unresolvable',
        });
    });
});
