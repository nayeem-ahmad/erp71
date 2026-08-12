import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BufferChannel, BufferPostMode, BufferService } from './buffer.service';
import { PushSocialPostDto, UpsertSocialPostDto } from './social-media.dto';
import {
    canTransition,
    SocialPostStatus,
    SocialPushStatus,
    statusAfterPush,
} from './social-media-status';

const MAX_PAGE_SIZE = 50;

/** How many pushes the list view carries per row — enough to show the last run. */
const RECENT_PUSHES = 10;

interface Actor {
    userId?: string;
    name?: string;
}

@Injectable()
export class SocialMediaService {
    private readonly logger = new Logger(SocialMediaService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly buffer: BufferService,
    ) {}

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    async list(options: { status?: string; search?: string; page?: number; limit?: number }) {
        const limit = Math.min(Math.max(options.limit ?? 20, 1), MAX_PAGE_SIZE);
        const page = Math.max(options.page ?? 1, 1);

        const where: Record<string, unknown> = { deleted_at: null };
        if (options.status) where.status = options.status;
        if (options.search) {
            where.OR = [
                { title: { contains: options.search, mode: 'insensitive' } },
                { content: { contains: options.search, mode: 'insensitive' } },
            ];
        }

        const [rows, total] = await Promise.all([
            this.db.socialMediaPost.findMany({
                where: where as any,
                orderBy: [{ created_at: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    pushes: { orderBy: { created_at: 'desc' }, take: RECENT_PUSHES },
                },
            }),
            this.db.socialMediaPost.count({ where: where as any }),
        ]);

        return { rows: rows.map((row) => this.toView(row)), total, page, limit };
    }

    async get(id: string) {
        const post = await this.db.socialMediaPost.findFirst({
            where: { id, deleted_at: null },
            include: { pushes: { orderBy: { created_at: 'desc' } } },
        });
        if (!post) throw new NotFoundException('Social post not found');
        return this.toView(post);
    }

    // -----------------------------------------------------------------------
    // Writes
    // -----------------------------------------------------------------------

    async create(dto: UpsertSocialPostDto, actor: Actor) {
        const status = dto.status ?? (dto.scheduled_for ? SocialPostStatus.SCHEDULED : SocialPostStatus.DRAFT);
        this.assertScheduleIsCoherent(status, dto.scheduled_for ?? null);

        const post = await this.db.socialMediaPost.create({
            data: {
                title: dto.title?.trim() || null,
                content: dto.content,
                link_url: dto.link_url || null,
                image_url: dto.image_url || null,
                networks: dto.networks ?? [],
                scheduled_for: dto.scheduled_for ? new Date(dto.scheduled_for) : null,
                status,
                author_user_id: actor.userId ?? null,
                author_name: actor.name ?? null,
            },
            include: { pushes: true },
        });
        return this.toView(post);
    }

    async update(id: string, dto: UpsertSocialPostDto) {
        const existing = await this.db.socialMediaPost.findFirst({ where: { id, deleted_at: null } });
        if (!existing) throw new NotFoundException('Social post not found');

        // A post already handed to Buffer cannot be edited back: changing the copy
        // here would not change what is sitting in the queue, so the row would
        // start lying about what was sent.
        if (existing.status === SocialPostStatus.PUBLISHED) {
            throw new BadRequestException(
                'This post has already been sent to Buffer. Duplicate it instead of editing it.',
            );
        }

        const status = dto.status ?? existing.status;
        if (dto.status && !canTransition(existing.status, dto.status)) {
            throw new BadRequestException(
                `Cannot move a ${existing.status.toLowerCase()} post to ${dto.status.toLowerCase()}.`,
            );
        }
        const scheduledFor = dto.scheduled_for === undefined
            ? existing.scheduled_for?.toISOString() ?? null
            : dto.scheduled_for;
        this.assertScheduleIsCoherent(status, scheduledFor);

        const post = await this.db.socialMediaPost.update({
            where: { id },
            data: {
                title: dto.title === undefined ? undefined : dto.title?.trim() || null,
                content: dto.content,
                link_url: dto.link_url === undefined ? undefined : dto.link_url || null,
                image_url: dto.image_url === undefined ? undefined : dto.image_url || null,
                networks: dto.networks ?? undefined,
                scheduled_for: scheduledFor ? new Date(scheduledFor) : null,
                status,
            },
            include: { pushes: { orderBy: { created_at: 'desc' } } },
        });
        return this.toView(post);
    }

    /**
     * Soft delete, matching the blog. The push history is the record of what
     * this platform said in public; a hard delete would throw it away while the
     * post itself stays live on Facebook.
     */
    async remove(id: string) {
        const existing = await this.db.socialMediaPost.findFirst({ where: { id, deleted_at: null } });
        if (!existing) throw new NotFoundException('Social post not found');
        await this.db.socialMediaPost.update({ where: { id }, data: { deleted_at: new Date() } });
        return { success: true };
    }

    /** Copies the content into a fresh draft — the way to "edit" a sent post. */
    async duplicate(id: string, actor: Actor) {
        const source = await this.db.socialMediaPost.findFirst({ where: { id, deleted_at: null } });
        if (!source) throw new NotFoundException('Social post not found');

        const post = await this.db.socialMediaPost.create({
            data: {
                title: source.title ? `${source.title} (copy)` : null,
                content: source.content,
                link_url: source.link_url,
                image_url: source.image_url,
                networks: source.networks,
                status: SocialPostStatus.DRAFT,
                author_user_id: actor.userId ?? null,
                author_name: actor.name ?? null,
            },
            include: { pushes: true },
        });
        return this.toView(post);
    }

    // -----------------------------------------------------------------------
    // Buffer
    // -----------------------------------------------------------------------

    async bufferStatus() {
        const config = await this.buffer.getConfig();
        return {
            configured: Boolean(config.accessToken && config.organizationId),
            default_channel_id: config.defaultChannelId,
        };
    }

    async listBufferChannels() {
        return this.buffer.listChannels();
    }

    /**
     * Proves the key works without publishing anything. Buffer has no ping, and
     * `channels` is the cheapest authenticated read — a wrong key fails it, and a
     * right key with nothing connected returns an empty list, which is the other
     * thing worth knowing before the first push.
     */
    async testBuffer() {
        const channels = await this.buffer.listChannels();
        return {
            success: true,
            channel_count: channels.length,
            channels: channels.map((channel) => ({
                id: channel.id,
                name: channel.name,
                service: channel.service,
            })),
        };
    }

    /**
     * Hands a post to Buffer, one call per channel.
     *
     * Channels are pushed in sequence rather than in parallel: a partial failure
     * has to be attributable to a specific page, and Buffer rate-limits per key,
     * so three concurrent calls are the shape most likely to trip it. One channel
     * failing does not stop the rest — each outcome is recorded on its own row.
     */
    async pushToBuffer(id: string, dto: PushSocialPostDto, actor: Actor) {
        const post = await this.db.socialMediaPost.findFirst({ where: { id, deleted_at: null } });
        if (!post) throw new NotFoundException('Social post not found');

        const config = await this.buffer.getConfig();
        const channelIds = dto.channel_ids?.length
            ? dto.channel_ids
            : config.defaultChannelId
              ? [config.defaultChannelId]
              : [];
        if (channelIds.length === 0) {
            throw new BadRequestException(
                'Pick at least one Buffer channel, or set a default channel under Platform Settings → Buffer.',
            );
        }

        const mode = (dto.mode as BufferPostMode) ?? BufferPostMode.ADD_TO_QUEUE;
        const dueAt = dto.due_at ?? (mode === BufferPostMode.CUSTOM_SCHEDULED
            ? post.scheduled_for?.toISOString() ?? null
            : null);
        if (mode === BufferPostMode.CUSTOM_SCHEDULED && !dueAt) {
            throw new BadRequestException('Scheduling to an exact time needs a date on the post.');
        }

        // Looked up once so each push row can record the page name even though
        // Buffer's mutation takes only an id.
        const channels: BufferChannel[] = await this.buffer.listChannels().catch(() => []);
        const byId = new Map(channels.map((channel) => [channel.id, channel] as const));

        const text = this.composeText(post.content, post.link_url);
        const results: { status: string; due_at: Date | null }[] = [];

        for (const channelId of channelIds) {
            const channel = byId.get(channelId);
            try {
                const created = await this.buffer.createPost({
                    channelId,
                    text,
                    mode,
                    dueAt,
                    imageUrl: post.image_url,
                    // Facebook rejects a post that does not declare its type,
                    // and only the channel knows which network it is.
                    service: channel?.service ?? null,
                });
                const resolvedDueAt = created.dueAt ? new Date(created.dueAt) : dueAt ? new Date(dueAt) : null;
                await this.db.socialMediaPostPush.create({
                    data: {
                        post_id: post.id,
                        channel_id: channelId,
                        channel_service: channel?.service ?? null,
                        channel_name: channel?.name ?? null,
                        mode,
                        due_at: resolvedDueAt,
                        status: SocialPushStatus.SENT,
                        external_post_id: created.id,
                        created_by: actor.userId ?? null,
                    },
                });
                results.push({ status: SocialPushStatus.SENT, due_at: resolvedDueAt });
            } catch (error) {
                const message = (error as Error).message ?? 'Unknown error';
                this.logger.error(`Buffer push failed for channel ${channelId}: ${message}`);
                await this.db.socialMediaPostPush.create({
                    data: {
                        post_id: post.id,
                        channel_id: channelId,
                        channel_service: channel?.service ?? null,
                        channel_name: channel?.name ?? null,
                        mode,
                        due_at: dueAt ? new Date(dueAt) : null,
                        status: SocialPushStatus.FAILED,
                        error: message.slice(0, 500),
                        created_by: actor.userId ?? null,
                    },
                });
                results.push({ status: SocialPushStatus.FAILED, due_at: null });
            }
        }

        const status = statusAfterPush(results);
        const updated = await this.db.socialMediaPost.update({
            where: { id: post.id },
            data: {
                status,
                published_at:
                    status === SocialPostStatus.PUBLISHED ? post.published_at ?? new Date() : post.published_at,
            },
            include: { pushes: { orderBy: { created_at: 'desc' } } },
        });

        const sent = results.filter((row) => row.status === SocialPushStatus.SENT).length;
        return {
            post: this.toView(updated),
            sent,
            failed: results.length - sent,
        };
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * The link is appended rather than passed as a field: Buffer has no separate
     * link input for `createPost`, and every network builds its preview card from
     * a URL found in the text.
     */
    private composeText(content: string, linkUrl: string | null): string {
        if (!linkUrl) return content;
        if (content.includes(linkUrl)) return content;
        return `${content.trimEnd()}\n\n${linkUrl}`;
    }

    private assertScheduleIsCoherent(status: string, scheduledFor: string | null) {
        if (status === SocialPostStatus.SCHEDULED && !scheduledFor) {
            throw new BadRequestException('A scheduled post needs a date and time.');
        }
    }

    private toView(post: any) {
        const pushes = (post.pushes ?? []).map((push: any) => ({
            id: push.id,
            channel_id: push.channel_id,
            channel_name: push.channel_name,
            channel_service: push.channel_service,
            mode: push.mode,
            due_at: push.due_at,
            status: push.status,
            external_post_id: push.external_post_id,
            error: push.error,
            created_at: push.created_at,
        }));

        return {
            id: post.id,
            status: post.status,
            title: post.title,
            content: post.content,
            link_url: post.link_url,
            image_url: post.image_url,
            networks: post.networks ?? [],
            scheduled_for: post.scheduled_for,
            published_at: post.published_at,
            author_name: post.author_name,
            created_at: post.created_at,
            updated_at: post.updated_at,
            pushes,
            last_push_at: pushes[0]?.created_at ?? null,
        };
    }
}
