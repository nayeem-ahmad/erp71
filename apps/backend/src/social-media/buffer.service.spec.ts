import { BadRequestException } from '@nestjs/common';
import { BufferPostMode, BufferService } from './buffer.service';

/**
 * The Buffer contract these tests pin down is the one that is easy to get wrong
 * from the outside: a GraphQL rejection arrives as HTTP 200 with a union member,
 * not as an error status. Everything here goes through a stubbed `fetch`.
 */
describe('BufferService', () => {
    const settings = {
        'social_buffer.access_token': 'key-123',
        'social_buffer.organization_id': 'org-1',
        'social_buffer.api_url': 'https://api.buffer.test',
        'social_buffer.default_channel_id': 'chan-fb',
    } as Record<string, string | null>;

    let platformSettings: any;
    let service: BufferService;
    let fetchMock: jest.Mock;

    function respond(body: unknown, status = 200) {
        fetchMock.mockResolvedValueOnce({
            ok: status >= 200 && status < 300,
            status,
            text: async () => JSON.stringify(body),
        });
    }

    beforeEach(() => {
        platformSettings = {
            getRawValue: jest.fn(async (group: string, key: string) => settings[`${group}.${key}`] ?? null),
        };
        service = new BufferService(platformSettings);
        fetchMock = jest.fn();
        (global as any).fetch = fetchMock;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('getConfig', () => {
        it('falls back to the documented endpoint when no api_url is set', async () => {
            platformSettings.getRawValue = jest.fn(async (group: string, key: string) =>
                key === 'api_url' ? null : settings[`${group}.${key}`] ?? null,
            );
            const config = await service.getConfig();
            expect(config.apiUrl).toBe('https://api.buffer.com');
        });

        it('reports unconfigured when the organisation id is missing', async () => {
            platformSettings.getRawValue = jest.fn(async (group: string, key: string) =>
                key === 'organization_id' ? null : settings[`${group}.${key}`] ?? null,
            );
            delete process.env.BUFFER_ORGANIZATION_ID;
            expect(await service.isConfigured()).toBe(false);
        });
    });

    describe('listChannels', () => {
        it('sends the key as a bearer token to the configured endpoint', async () => {
            respond({ data: { channels: [{ id: 'chan-fb', name: 'ERP71', service: 'facebook' }] } });

            const channels = await service.listChannels();

            expect(channels).toHaveLength(1);
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe('https://api.buffer.test');
            expect(init.headers.Authorization).toBe('Bearer key-123');
            expect(JSON.parse(init.body).variables).toEqual({ organizationId: 'org-1' });
        });

        it('declares the organisation id as Buffer types it, not as String', async () => {
            // Buffer's schema types this argument as the custom scalar
            // `OrganizationId!`. GraphQL does not coerce between distinct
            // scalars, so declaring `String!` fails validation before the
            // query ever runs: "Variable "$organizationId" of type "String!"
            // used in position expecting type "OrganizationId!"".
            respond({ data: { channels: [] } });

            await service.listChannels();

            const [, init] = fetchMock.mock.calls[0];
            expect(JSON.parse(init.body).query).toContain('$organizationId: OrganizationId!');
        });

        it('filters by service without a second round trip', async () => {
            respond({
                data: {
                    channels: [
                        { id: 'chan-fb', name: 'ERP71', service: 'facebook' },
                        { id: 'chan-li', name: 'ERP71', service: 'linkedin' },
                    ],
                },
            });

            const channels = await service.listChannelsForService('FaceBook');

            expect(channels.map((c) => c.id)).toEqual(['chan-fb']);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('refuses to call out at all when Buffer is not configured', async () => {
            platformSettings.getRawValue = jest.fn(async () => null);
            delete process.env.BUFFER_ACCESS_TOKEN;
            delete process.env.BUFFER_ORGANIZATION_ID;

            await expect(service.listChannels()).rejects.toBeInstanceOf(BadRequestException);
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe('error reporting', () => {
        it('surfaces every GraphQL error, not just the first', async () => {
            // A malformed document fails validation once per bad position, so
            // reporting only errors[0] hides the rest and costs a deploy per
            // mismatch to discover them.
            respond({
                errors: [
                    { message: 'Variable "$a" of type "String!" used in position expecting type "OrganizationId!".' },
                    { message: 'Variable "$b" of type "String!" used in position expecting type "ChannelId!".' },
                ],
            });

            await expect(service.listChannels()).rejects.toThrow(/OrganizationId!.*ChannelId!/s);
        });
    });

    describe('createPost', () => {
        it('returns the created post on success', async () => {
            respond({
                data: {
                    createPost: {
                        __typename: 'PostActionSuccess',
                        post: { id: 'post-1', dueAt: '2026-08-09T10:00:00.000Z', status: 'scheduled' },
                    },
                },
            });

            const result = await service.createPost({
                channelId: 'chan-fb',
                text: 'Hello Dhaka',
                mode: BufferPostMode.ADD_TO_QUEUE,
            });

            expect(result).toEqual({
                id: 'post-1',
                dueAt: '2026-08-09T10:00:00.000Z',
                status: 'scheduled',
            });
        });

        it('treats a MutationError as a failure even though HTTP said 200', async () => {
            respond({
                data: {
                    createPost: { __typename: 'LimitReachedError', message: 'Channel queue limit reached' },
                },
            });

            await expect(
                service.createPost({ channelId: 'chan-fb', text: 'Hi', mode: BufferPostMode.ADD_TO_QUEUE }),
            ).rejects.toThrow('Channel queue limit reached');
        });

        it('surfaces a top-level GraphQL error', async () => {
            respond({ errors: [{ message: 'Unauthorized' }] });

            await expect(
                service.createPost({ channelId: 'chan-fb', text: 'Hi', mode: BufferPostMode.ADD_TO_QUEUE }),
            ).rejects.toThrow('Unauthorized');
        });

        it('sends dueAt only for customScheduled', async () => {
            respond({ data: { createPost: { post: { id: 'p1' } } } });
            await service.createPost({
                channelId: 'chan-fb',
                text: 'Hi',
                mode: BufferPostMode.ADD_TO_QUEUE,
                dueAt: '2026-08-09T10:00:00.000Z',
            });
            expect(JSON.parse(fetchMock.mock.calls[0][1].body).variables.input.dueAt).toBeUndefined();

            respond({ data: { createPost: { post: { id: 'p2' } } } });
            await service.createPost({
                channelId: 'chan-fb',
                text: 'Hi',
                mode: BufferPostMode.CUSTOM_SCHEDULED,
                dueAt: '2026-08-09T10:00:00.000Z',
            });
            expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables.input.dueAt).toBe(
                '2026-08-09T10:00:00.000Z',
            );
        });

        it('rejects a customScheduled post with no date before calling Buffer', async () => {
            await expect(
                service.createPost({ channelId: 'chan-fb', text: 'Hi', mode: BufferPostMode.CUSTOM_SCHEDULED }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('attaches an image as an asset entry', async () => {
            respond({ data: { createPost: { post: { id: 'p1' } } } });

            await service.createPost({
                channelId: 'chan-fb',
                text: 'Hi',
                mode: BufferPostMode.NOW,
                imageUrl: 'https://cdn.erp71.com/a.png',
            });

            expect(JSON.parse(fetchMock.mock.calls[0][1].body).variables.input.assets).toEqual([
                { image: { url: 'https://cdn.erp71.com/a.png' } },
            ]);
        });

        it('reports a network failure as a reachability problem, not a rejection', async () => {
            fetchMock.mockRejectedValueOnce(new Error('socket hang up'));

            await expect(
                service.createPost({ channelId: 'chan-fb', text: 'Hi', mode: BufferPostMode.NOW }),
            ).rejects.toThrow('Could not reach Buffer: socket hang up');
        });
    });
});
