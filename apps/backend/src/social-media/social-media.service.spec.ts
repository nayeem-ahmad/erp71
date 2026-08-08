import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SocialMediaService } from './social-media.service';
import { SocialPostStatus, SocialPushStatus } from './social-media-status';
import { BufferPostMode } from './buffer.service';

describe('SocialMediaService', () => {
    let db: any;
    let buffer: any;
    let service: SocialMediaService;

    const actor = { userId: 'user-1', name: 'Nayeem' };

    function post(overrides: Record<string, unknown> = {}) {
        return {
            id: 'post-1',
            status: SocialPostStatus.DRAFT,
            title: 'Eid campaign',
            content: 'Eid Mubarak from ERP71',
            link_url: null,
            image_url: null,
            networks: ['facebook'],
            scheduled_for: null,
            published_at: null,
            author_name: 'Nayeem',
            created_at: new Date(),
            updated_at: new Date(),
            pushes: [],
            ...overrides,
        };
    }

    beforeEach(() => {
        db = {
            socialMediaPost: {
                findFirst: jest.fn(),
                findMany: jest.fn(),
                count: jest.fn(),
                create: jest.fn(async ({ data }: any) => post(data)),
                update: jest.fn(async ({ data }: any) => post(data)),
            },
            socialMediaPostPush: { create: jest.fn(async ({ data }: any) => data) },
        };
        buffer = {
            getConfig: jest.fn(async () => ({
                accessToken: 'key',
                organizationId: 'org',
                apiUrl: 'https://api.buffer.test',
                defaultChannelId: 'chan-fb',
            })),
            listChannels: jest.fn(async () => [
                { id: 'chan-fb', name: 'ERP71 BD', service: 'facebook' },
                { id: 'chan-li', name: 'ERP71', service: 'linkedin' },
            ]),
            createPost: jest.fn(async () => ({ id: 'buffer-1', dueAt: null, status: 'sent' })),
        };
        service = new SocialMediaService(db, buffer);
    });

    describe('create', () => {
        it('defaults an undated post to DRAFT', async () => {
            await service.create({ content: 'Hello' } as any, actor);
            expect(db.socialMediaPost.create.mock.calls[0][0].data.status).toBe(SocialPostStatus.DRAFT);
        });

        it('infers SCHEDULED from a date', async () => {
            await service.create(
                { content: 'Hello', scheduled_for: '2026-09-01T09:00:00.000Z' } as any,
                actor,
            );
            expect(db.socialMediaPost.create.mock.calls[0][0].data.status).toBe(SocialPostStatus.SCHEDULED);
        });

        it('refuses SCHEDULED without a date', async () => {
            await expect(
                service.create({ content: 'Hello', status: SocialPostStatus.SCHEDULED } as any, actor),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('update', () => {
        it('refuses to edit a post that is already in Buffer', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(post({ status: SocialPostStatus.PUBLISHED }));

            await expect(service.update('post-1', { content: 'New copy' } as any)).rejects.toThrow(
                /already been sent to Buffer/,
            );
        });

        it('rejects a transition the lifecycle does not allow', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(post({ status: SocialPostStatus.DRAFT }));

            await expect(
                service.update('post-1', { content: 'x', status: 'NONSENSE' } as any),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('404s on a soft-deleted post', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(null);
            await expect(service.update('gone', { content: 'x' } as any)).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe('pushToBuffer', () => {
        it('falls back to the default channel when none is named', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(post());

            await service.pushToBuffer('post-1', {}, actor);

            expect(buffer.createPost).toHaveBeenCalledTimes(1);
            expect(buffer.createPost.mock.calls[0][0].channelId).toBe('chan-fb');
        });

        it('refuses when there is no channel and no default', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(post());
            buffer.getConfig.mockResolvedValue({
                accessToken: 'key',
                organizationId: 'org',
                apiUrl: 'x',
                defaultChannelId: null,
            });

            await expect(service.pushToBuffer('post-1', {}, actor)).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(buffer.createPost).not.toHaveBeenCalled();
        });

        it('appends the link so the network builds a preview card', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(
                post({ content: 'Read this', link_url: 'https://erp71.com/blog/x' }),
            );

            await service.pushToBuffer('post-1', { channel_ids: ['chan-fb'] }, actor);

            expect(buffer.createPost.mock.calls[0][0].text).toBe('Read this\n\nhttps://erp71.com/blog/x');
        });

        it('does not append a link the copy already contains', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(
                post({ content: 'See https://erp71.com/blog/x now', link_url: 'https://erp71.com/blog/x' }),
            );

            await service.pushToBuffer('post-1', { channel_ids: ['chan-fb'] }, actor);

            expect(buffer.createPost.mock.calls[0][0].text).toBe('See https://erp71.com/blog/x now');
        });

        it('records the channel name so the history survives a disconnect', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(post());

            await service.pushToBuffer('post-1', { channel_ids: ['chan-li'] }, actor);

            const push = db.socialMediaPostPush.create.mock.calls[0][0].data;
            expect(push.channel_name).toBe('ERP71');
            expect(push.channel_service).toBe('linkedin');
        });

        it('keeps going after one channel fails and records both outcomes', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(post());
            buffer.createPost
                .mockRejectedValueOnce(new Error('Channel queue limit reached'))
                .mockResolvedValueOnce({ id: 'buffer-2', dueAt: null, status: 'sent' });

            const result = await service.pushToBuffer(
                'post-1',
                { channel_ids: ['chan-fb', 'chan-li'] },
                actor,
            );

            expect(result.sent).toBe(1);
            expect(result.failed).toBe(1);
            const rows = db.socialMediaPostPush.create.mock.calls.map((call: any[]) => call[0].data);
            expect(rows[0]).toMatchObject({
                status: SocialPushStatus.FAILED,
                error: 'Channel queue limit reached',
            });
            expect(rows[1]).toMatchObject({ status: SocialPushStatus.SENT, external_post_id: 'buffer-2' });
        });

        it('marks the post FAILED when nothing got through', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(post());
            buffer.createPost.mockRejectedValue(new Error('nope'));

            await service.pushToBuffer('post-1', { channel_ids: ['chan-fb'] }, actor);

            expect(db.socialMediaPost.update.mock.calls[0][0].data.status).toBe(SocialPostStatus.FAILED);
        });

        it('stamps published_at once the post is out', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(post());

            await service.pushToBuffer('post-1', { channel_ids: ['chan-fb'] }, actor);

            const data = db.socialMediaPost.update.mock.calls[0][0].data;
            expect(data.status).toBe(SocialPostStatus.PUBLISHED);
            expect(data.published_at).toBeInstanceOf(Date);
        });

        it('uses the post date when scheduling to an exact time', async () => {
            const scheduled = new Date('2026-09-01T09:00:00.000Z');
            db.socialMediaPost.findFirst.mockResolvedValue(
                post({ status: SocialPostStatus.SCHEDULED, scheduled_for: scheduled }),
            );

            await service.pushToBuffer(
                'post-1',
                { channel_ids: ['chan-fb'], mode: BufferPostMode.CUSTOM_SCHEDULED },
                actor,
            );

            expect(buffer.createPost.mock.calls[0][0].dueAt).toBe(scheduled.toISOString());
        });

        it('refuses an exact-time push with no date anywhere', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(post({ scheduled_for: null }));

            await expect(
                service.pushToBuffer(
                    'post-1',
                    { channel_ids: ['chan-fb'], mode: BufferPostMode.CUSTOM_SCHEDULED },
                    actor,
                ),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('still pushes when the channel lookup fails', async () => {
            // The names are cosmetic; losing them must not block publishing.
            db.socialMediaPost.findFirst.mockResolvedValue(post());
            buffer.listChannels.mockRejectedValue(new Error('rate limited'));

            const result = await service.pushToBuffer('post-1', { channel_ids: ['chan-fb'] }, actor);

            expect(result.sent).toBe(1);
            expect(db.socialMediaPostPush.create.mock.calls[0][0].data.channel_name).toBeNull();
        });
    });

    describe('remove', () => {
        it('soft-deletes so the push history survives', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(post());

            await service.remove('post-1');

            expect(db.socialMediaPost.update.mock.calls[0][0].data.deleted_at).toBeInstanceOf(Date);
        });
    });

    describe('duplicate', () => {
        it('copies the copy into a fresh draft', async () => {
            db.socialMediaPost.findFirst.mockResolvedValue(
                post({ status: SocialPostStatus.PUBLISHED, title: 'Eid campaign' }),
            );

            await service.duplicate('post-1', actor);

            const data = db.socialMediaPost.create.mock.calls[0][0].data;
            expect(data.status).toBe(SocialPostStatus.DRAFT);
            expect(data.title).toBe('Eid campaign (copy)');
            expect(data.published_at).toBeUndefined();
        });
    });
});
