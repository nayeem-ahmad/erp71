import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CrmMessageTemplatesService } from './crm-message-templates.service';
import { DatabaseService } from '../database/database.service';

describe('CrmMessageTemplatesService', () => {
    let service: CrmMessageTemplatesService;
    let db: any;

    const reminder = {
        id: 'tpl-1',
        tenant_id: 'tenant-1',
        name: 'Payment reminder',
        usage: 'BOTH',
        channel_id: null,
        purpose_id: null,
        subject: null,
        body: 'Dear {{name}}, your invoice is outstanding.',
        sort_order: 1,
        is_active: true,
    };

    beforeEach(async () => {
        db = {
            crmMessageTemplate: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                aggregate: jest.fn().mockResolvedValue({ _max: { sort_order: 4 } }),
            },
            conversationChannel: { findFirst: jest.fn().mockResolvedValue({ id: 'ch-wa' }) },
            crmActivityPurpose: { findFirst: jest.fn().mockResolvedValue({ id: 'p-col' }) },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [CrmMessageTemplatesService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(CrmMessageTemplatesService);
    });

    describe('list()', () => {
        /**
         * The picker asks for one composer's templates. A template marked BOTH
         * belongs in either, so filtering on equality would hide the ones most
         * worth having.
         */
        it('returns BOTH alongside the composer that asked', async () => {
            await service.list('tenant-1', { usage: 'LOG' });

            expect(db.crmMessageTemplate.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ usage: { in: ['LOG', 'BOTH'] } }),
                }),
            );
        });

        /**
         * A template with no channel is offered everywhere, so narrowing to a
         * channel must not drop the generic ones — otherwise pinning one
         * template to WhatsApp would empty the picker for every other channel.
         */
        it('keeps channel-agnostic templates when filtering by channel', async () => {
            await service.list('tenant-1', { channelId: 'ch-wa' });

            expect(db.crmMessageTemplate.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: [{ channel_id: 'ch-wa' }, { channel_id: null }],
                    }),
                }),
            );
        });

        it('hides deactivated templates unless Setup asks for them', async () => {
            await service.list('tenant-1', {});
            expect(db.crmMessageTemplate.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ is_active: true }) }),
            );

            db.crmMessageTemplate.findMany.mockClear();
            await service.list('tenant-1', { includeInactive: true });
            expect(db.crmMessageTemplate.findMany.mock.calls[0][0].where.is_active).toBeUndefined();
        });
    });

    describe('create()', () => {
        it('appends to the end of the tenant list', async () => {
            await service.create('tenant-1', 'user-1', {
                name: 'Thanks for visiting',
                body: 'Thank you {{name}}.',
            });

            expect(db.crmMessageTemplate.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        sort_order: 5,
                        usage: 'BOTH',
                        created_by: 'user-1',
                    }),
                }),
            );
        });

        /** The DB unique index is exact-match, so only this check catches a re-case. */
        it('rejects a name that differs only by case or spacing', async () => {
            db.crmMessageTemplate.findMany.mockResolvedValue([reminder]);

            await expect(
                service.create('tenant-1', 'user-1', {
                    name: 'payment  reminder',
                    body: 'Anything.',
                }),
            ).rejects.toBeInstanceOf(ConflictException);
            expect(db.crmMessageTemplate.create).not.toHaveBeenCalled();
        });

        /** A channel id from another tenant must not become a cross-tenant link. */
        it('refuses a channel the tenant does not own', async () => {
            db.conversationChannel.findFirst.mockResolvedValue(null);

            await expect(
                service.create('tenant-1', 'user-1', {
                    name: 'Follow up',
                    body: 'Hello.',
                    channel_id: '11111111-1111-4111-8111-111111111111',
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.crmMessageTemplate.create).not.toHaveBeenCalled();
        });
    });

    describe('update()', () => {
        beforeEach(() => {
            db.crmMessageTemplate.findFirst.mockResolvedValue(reminder);
        });

        /**
         * "Offer this on every channel" is a real edit. Skipping the key as
         * unchanged would leave the old link standing and the template would
         * keep hiding on every other channel.
         */
        it('writes a cleared channel through as null', async () => {
            await service.update('tenant-1', 'tpl-1', { channel_id: null });

            expect(db.crmMessageTemplate.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ channel_id: null }) }),
            );
        });

        it('leaves untouched fields alone', async () => {
            await service.update('tenant-1', 'tpl-1', { is_active: false });

            const { data } = db.crmMessageTemplate.update.mock.calls[0][0];
            expect(data).toEqual({ is_active: false });
        });

        it('does not reach a template belonging to another tenant', async () => {
            db.crmMessageTemplate.findFirst.mockResolvedValue(null);

            await expect(
                service.update('tenant-1', 'tpl-1', { name: 'Renamed' }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('remove()', () => {
        it('deletes outright — nothing points back at a template', async () => {
            db.crmMessageTemplate.findFirst.mockResolvedValue(reminder);

            await expect(service.remove('tenant-1', 'tpl-1')).resolves.toEqual({ success: true });
            expect(db.crmMessageTemplate.delete).toHaveBeenCalledWith({ where: { id: 'tpl-1' } });
        });

        it('refuses one the tenant does not own', async () => {
            db.crmMessageTemplate.findFirst.mockResolvedValue(null);

            await expect(service.remove('tenant-1', 'tpl-1')).rejects.toBeInstanceOf(NotFoundException);
            expect(db.crmMessageTemplate.delete).not.toHaveBeenCalled();
        });
    });
});
