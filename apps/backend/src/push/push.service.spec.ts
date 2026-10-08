import { BadRequestException } from '@nestjs/common';
import { hashRefreshToken } from '../auth/refresh-token.service';
import { PushService } from './push.service';

describe('PushService', () => {
    const future = new Date(Date.now() + 86_400_000);
    let db: any;
    let fcm: { enabled: boolean; send: jest.Mock };
    let service: PushService;

    beforeEach(() => {
        db = {
            refreshToken: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
            deviceToken: {
                upsert: jest.fn(),
                deleteMany: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
            },
        };
        fcm = { enabled: true, send: jest.fn().mockResolvedValue('sent') };
        service = new PushService(db, fcm as any);
    });

    describe('register', () => {
        const input = { token: 'fcm-1', platform: 'android', appVersion: '0.2.0', refreshToken: 'refresh-raw' };

        it("files the phone under the session family its refresh token belongs to", async () => {
            db.refreshToken.findUnique.mockResolvedValue({
                id: 'rt-1', user_id: 'u1', family_id: 'fam-1', revoked_at: null, expires_at: future,
            });

            await service.register('u1', input);

            expect(db.refreshToken.findUnique).toHaveBeenCalledWith(
                expect.objectContaining({ where: { token_hash: hashRefreshToken('refresh-raw') } }),
            );
            expect(db.deviceToken.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { token: 'fcm-1' },
                    // The update moves a token another account registered to this one.
                    update: expect.objectContaining({ user_id: 'u1', session_family_id: 'fam-1', platform: 'android' }),
                }),
            );
        });

        it('treats a pre-family token as its own family', async () => {
            db.refreshToken.findUnique.mockResolvedValue({
                id: 'rt-old', user_id: 'u1', family_id: null, revoked_at: null, expires_at: future,
            });
            await service.register('u1', input);
            expect(db.deviceToken.upsert.mock.calls[0][0].create.session_family_id).toBe('rt-old');
        });

        it.each([
            ['unknown', null],
            ["someone else's", { id: 'rt', user_id: 'u2', family_id: 'f', revoked_at: null, expires_at: future }],
            ['revoked', { id: 'rt', user_id: 'u1', family_id: 'f', revoked_at: new Date(), expires_at: future }],
            ['expired', { id: 'rt', user_id: 'u1', family_id: 'f', revoked_at: null, expires_at: new Date(0) }],
        ])('refuses a %s session', async (_label, row) => {
            db.refreshToken.findUnique.mockResolvedValue(row);
            await expect(service.register('u1', input)).rejects.toBeInstanceOf(BadRequestException);
            expect(db.deviceToken.upsert).not.toHaveBeenCalled();
        });
    });

    it('unregisters only the caller’s own device', async () => {
        await service.unregister('u1', 'fcm-1');
        expect(db.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { token: 'fcm-1', user_id: 'u1' } });
    });

    describe('sendToUsers', () => {
        const message = { title: 'Hi', body: 'There' };

        it('sends only to devices whose session is still live, and drops the rest', async () => {
            db.deviceToken.findMany.mockResolvedValue([
                { id: 'd1', token: 'live', session_family_id: 'fam-live' },
                { id: 'd2', token: 'dead', session_family_id: 'fam-dead' },
                { id: 'd3', token: 'old', session_family_id: 'rt-old' },
            ]);
            db.refreshToken.findMany.mockResolvedValue([
                { id: 'rt-9', family_id: 'fam-live' },
                { id: 'rt-old', family_id: null },
            ]);

            const reached = await service.sendToUsers(['u1', 'u1'], message);

            expect(db.deviceToken.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: { in: ['u1'] } } }));
            expect(fcm.send.mock.calls.map((c) => c[0])).toEqual(['live', 'old']);
            expect(db.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['d2'] } } });
            expect(reached).toBe(2);
        });

        it('forgets a token FCM says is gone', async () => {
            db.deviceToken.findMany.mockResolvedValue([{ id: 'd1', token: 'gone', session_family_id: 'f' }]);
            db.refreshToken.findMany.mockResolvedValue([{ id: 'rt', family_id: 'f' }]);
            fcm.send.mockResolvedValue('unregistered');

            expect(await service.sendToUsers(['u1'], message)).toBe(0);
            expect(db.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['d1'] } } });
        });

        it('does nothing when push is not configured', async () => {
            fcm.enabled = false;
            expect(await service.sendToUsers(['u1'], message)).toBe(0);
            expect(db.deviceToken.findMany).not.toHaveBeenCalled();
        });

        it('never throws: a push is best effort on top of the notification', async () => {
            db.deviceToken.findMany.mockRejectedValue(new Error('db down'));
            await expect(service.sendToUsers(['u1'], message)).resolves.toBe(0);
        });
    });
});
