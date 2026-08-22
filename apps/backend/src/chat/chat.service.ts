import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatAccessService, ChatViewer } from './chat-access.service';
import { ChatAttachmentsService, PreparedAttachment } from './chat-attachments.service';
import {
    AddParticipantsDto,
    CreateConversationDto,
    EditMessageDto,
    ListMessagesDto,
    SendMessageDto,
    UpdateConversationDto,
} from './chat.dto';
import {
    buildDmKey,
    buildPreview,
    CHAT_EDIT_WINDOW_MS,
    MAX_GROUP_PARTICIPANTS,
} from './chat.util';

const USER_SELECT = { id: true, name: true, email: true, avatar_url: true } as const;

const MESSAGE_SELECT = {
    id: true,
    conversation_id: true,
    sender_id: true,
    body: true,
    kind: true,
    edited_at: true,
    deleted_at: true,
    created_at: true,
    sender: { select: USER_SELECT },
    attachments: {
        select: {
            id: true,
            file_url: true,
            file_name: true,
            mime_type: true,
            file_size: true,
        },
    },
} as const;

const DEFAULT_MESSAGE_PAGE = 30;
const MAX_MESSAGE_PAGE = 100;

@Injectable()
export class ChatService {
    private readonly logger = new Logger(ChatService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly access: ChatAccessService,
        private readonly attachments: ChatAttachmentsService,
        private readonly notifications: NotificationsService,
    ) {}

    /* ------------------------------------------------------------------ */
    /*  Conversations                                                      */
    /* ------------------------------------------------------------------ */

    /**
     * Every conversation the caller is still a member of. Unread counts are one
     * grouped query rather than one per row: the list is polled, so an N+1 here
     * would be N+1 every 30 seconds per open client.
     */
    async listConversations(viewer: ChatViewer) {
        const memberships = await this.db.chatParticipant.findMany({
            where: {
                user_id: viewer.userId,
                left_at: null,
                conversation: { tenant_id: viewer.tenantId },
            },
            select: {
                last_read_at: true,
                muted_until: true,
                conversation: {
                    select: {
                        id: true,
                        kind: true,
                        title: true,
                        archived_at: true,
                        created_at: true,
                        last_message_at: true,
                        last_message_preview: true,
                        participants: {
                            where: { left_at: null },
                            select: { user_id: true, role: true, user: { select: USER_SELECT } },
                        },
                    },
                },
            },
        });

        if (memberships.length === 0) return [];

        const unread = await this.unreadCountsFor(viewer.userId, memberships);

        return memberships
            .map((membership) => {
                const conversation = membership.conversation;
                const others = conversation.participants.filter(
                    (participant) => participant.user_id !== viewer.userId,
                );
                return {
                    id: conversation.id,
                    kind: conversation.kind,
                    // A DM is titled by whoever you are talking to, which is why
                    // this is resolved per viewer rather than stored.
                    title:
                        conversation.kind === 'dm'
                            ? (others[0]?.user.name ?? others[0]?.user.email ?? 'Unknown')
                            : (conversation.title ?? 'Group'),
                    archived: conversation.archived_at !== null,
                    muted: (membership.muted_until?.getTime() ?? 0) > Date.now(),
                    lastMessageAt: conversation.last_message_at,
                    lastMessagePreview: conversation.last_message_preview,
                    unreadCount: unread.get(conversation.id) ?? 0,
                    participants: conversation.participants.map((participant) => ({
                        id: participant.user.id,
                        name: participant.user.name,
                        email: participant.user.email,
                        avatarUrl: participant.user.avatar_url,
                        role: participant.role,
                    })),
                    createdAt: conversation.created_at,
                };
            })
            .sort((a, b) => {
                // Archived conversations sink; the rest are newest-activity first,
                // falling back to creation so a brand-new empty thread is visible.
                if (a.archived !== b.archived) return a.archived ? 1 : -1;
                const aAt = (a.lastMessageAt ?? a.createdAt).getTime();
                const bAt = (b.lastMessageAt ?? b.createdAt).getTime();
                return bAt - aAt;
            });
    }

    /**
     * Unread per conversation in one grouped query.
     *
     * `last_read_at` is per participant, so the counts cannot come from a single
     * `WHERE created_at > x` — each conversation has its own cutoff. Grouping by
     * conversation and comparing in memory keeps it to one round trip.
     */
    private async unreadCountsFor(
        userId: string,
        memberships: { last_read_at: Date | null; conversation: { id: string } }[],
    ): Promise<Map<string, number>> {
        const cutoffs = new Map(
            memberships.map((m) => [m.conversation.id, m.last_read_at] as const),
        );

        const rows = await this.db.chatMessage.groupBy({
            by: ['conversation_id'],
            where: {
                conversation_id: { in: [...cutoffs.keys()] },
                // Your own messages are never unread to you.
                sender_id: { not: userId },
                deleted_at: null,
                kind: 'text',
                OR: [...cutoffs.entries()].map(([conversationId, cutoff]) => ({
                    conversation_id: conversationId,
                    ...(cutoff ? { created_at: { gt: cutoff } } : {}),
                })),
            },
            _count: { _all: true },
        });

        return new Map(rows.map((row) => [row.conversation_id, row._count._all]));
    }

    /** Total unread across the workspace — the header badge polls this. */
    async unreadCount(viewer: ChatViewer): Promise<{ count: number }> {
        const memberships = await this.db.chatParticipant.findMany({
            where: {
                user_id: viewer.userId,
                left_at: null,
                // Expiry-aware, not `muted_until: null`: a mute that has run out
                // leaves a past date behind, and matching on null alone would
                // drop that conversation from the badge permanently after one
                // temporary mute.
                OR: [{ muted_until: null }, { muted_until: { lt: new Date() } }],
                conversation: { tenant_id: viewer.tenantId, archived_at: null },
            },
            select: { last_read_at: true, conversation: { select: { id: true } } },
        });

        if (memberships.length === 0) return { count: 0 };

        const counts = await this.unreadCountsFor(viewer.userId, memberships);
        let total = 0;
        for (const value of counts.values()) total += value;
        return { count: total };
    }

    async createConversation(viewer: ChatViewer, dto: CreateConversationDto) {
        const requested = [...new Set(dto.participantIds)].filter((id) => id !== viewer.userId);
        if (requested.length === 0) {
            throw new BadRequestException('Pick at least one other person.');
        }

        // A participant from another workspace would straddle two tenants, so the
        // ids are checked against membership rather than trusted from the body.
        const valid = await this.access.filterTenantMemberIds(viewer.tenantId, requested);
        if (valid.length !== requested.length) {
            throw new BadRequestException('One or more people are not members of this workspace.');
        }

        return dto.kind === 'dm'
            ? this.openDirectMessage(viewer, valid)
            : this.createGroup(viewer, valid, dto.title ?? '');
    }

    private async openDirectMessage(viewer: ChatViewer, otherIds: string[]) {
        if (otherIds.length !== 1) {
            throw new BadRequestException('A direct message has exactly one other person.');
        }
        const dmKey = buildDmKey(viewer.userId, otherIds[0]);

        const existing = await this.db.chatConversation.findUnique({
            where: { tenant_id_dm_key: { tenant_id: viewer.tenantId, dm_key: dmKey } },
            select: { id: true },
        });
        if (existing) return this.getConversation(viewer, existing.id);

        try {
            const created = await this.db.chatConversation.create({
                data: {
                    tenant_id: viewer.tenantId,
                    kind: 'dm',
                    dm_key: dmKey,
                    created_by: viewer.userId,
                    participants: {
                        create: [viewer.userId, otherIds[0]].map((userId) => ({
                            user_id: userId,
                            // Nothing to administer in a DM; both sides are equal.
                            role: 'admin',
                        })),
                    },
                },
                select: { id: true },
            });
            return this.getConversation(viewer, created.id);
        } catch (error) {
            // Two people tapping "message" on each other at the same moment race
            // past the findUnique above. The index turns that into P2002 rather
            // than a second thread; both callers should land on the same row.
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                const winner = await this.db.chatConversation.findUnique({
                    where: { tenant_id_dm_key: { tenant_id: viewer.tenantId, dm_key: dmKey } },
                    select: { id: true },
                });
                if (winner) return this.getConversation(viewer, winner.id);
            }
            throw error;
        }
    }

    private async createGroup(viewer: ChatViewer, memberIds: string[], title: string) {
        const trimmed = title.trim();
        if (!trimmed) throw new BadRequestException('Give the group a name.');
        if (memberIds.length + 1 > MAX_GROUP_PARTICIPANTS) {
            throw new BadRequestException(`A group holds at most ${MAX_GROUP_PARTICIPANTS} people.`);
        }

        const created = await this.db.chatConversation.create({
            data: {
                tenant_id: viewer.tenantId,
                kind: 'group',
                title: trimmed,
                created_by: viewer.userId,
                participants: {
                    create: [
                        { user_id: viewer.userId, role: 'admin' },
                        ...memberIds.map((userId) => ({ user_id: userId, role: 'member' })),
                    ],
                },
            },
            select: { id: true },
        });

        return this.getConversation(viewer, created.id);
    }

    async getConversation(viewer: ChatViewer, conversationId: string) {
        await this.access.requireMembership(viewer, conversationId);

        const conversation = await this.db.chatConversation.findUnique({
            where: { id: conversationId },
            select: {
                id: true,
                kind: true,
                title: true,
                archived_at: true,
                created_at: true,
                created_by: true,
                last_message_at: true,
                last_message_preview: true,
                participants: {
                    where: { left_at: null },
                    select: { user_id: true, role: true, user: { select: USER_SELECT } },
                },
            },
        });
        if (!conversation) throw new NotFoundException('Conversation not found.');

        const others = conversation.participants.filter((p) => p.user_id !== viewer.userId);

        return {
            id: conversation.id,
            kind: conversation.kind,
            title:
                conversation.kind === 'dm'
                    ? (others[0]?.user.name ?? others[0]?.user.email ?? 'Unknown')
                    : (conversation.title ?? 'Group'),
            archived: conversation.archived_at !== null,
            createdAt: conversation.created_at,
            createdBy: conversation.created_by,
            lastMessageAt: conversation.last_message_at,
            lastMessagePreview: conversation.last_message_preview,
            participants: conversation.participants.map((participant) => ({
                id: participant.user.id,
                name: participant.user.name,
                email: participant.user.email,
                avatarUrl: participant.user.avatar_url,
                role: participant.role,
            })),
        };
    }

    async updateConversation(
        viewer: ChatViewer,
        conversationId: string,
        dto: UpdateConversationDto,
    ) {
        const membership = await this.access.requireMembership(viewer, conversationId);

        // Muting is a personal setting; renaming and archiving change the thread
        // for everyone, so only a group admin may do those.
        if (dto.muteMinutes !== undefined) {
            await this.db.chatParticipant.update({
                where: { id: membership.participantId },
                data: {
                    muted_until:
                        dto.muteMinutes > 0
                            ? new Date(Date.now() + dto.muteMinutes * 60_000)
                            : null,
                },
            });
        }

        if (dto.title !== undefined || dto.archived !== undefined) {
            if (membership.kind !== 'group') {
                throw new BadRequestException('A direct message cannot be renamed or archived.');
            }
            this.assertGroupAdmin(membership.role);

            await this.db.chatConversation.update({
                where: { id: conversationId },
                data: {
                    ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
                    ...(dto.archived !== undefined
                        ? { archived_at: dto.archived ? new Date() : null }
                        : {}),
                },
            });

            if (dto.title !== undefined) {
                await this.writeSystemMessage(
                    viewer,
                    conversationId,
                    `renamed the group to "${dto.title.trim()}"`,
                );
            }
        }

        return this.getConversation(viewer, conversationId);
    }

    /* ------------------------------------------------------------------ */
    /*  Participants                                                       */
    /* ------------------------------------------------------------------ */

    async addParticipants(viewer: ChatViewer, conversationId: string, dto: AddParticipantsDto) {
        const membership = await this.access.requireMembership(viewer, conversationId);
        if (membership.kind !== 'group') {
            throw new BadRequestException('People cannot be added to a direct message.');
        }
        this.assertGroupAdmin(membership.role);

        const requested = [...new Set(dto.participantIds)];
        const valid = await this.access.filterTenantMemberIds(viewer.tenantId, requested);
        if (valid.length !== requested.length) {
            throw new BadRequestException('One or more people are not members of this workspace.');
        }

        const existing = await this.db.chatParticipant.findMany({
            where: { conversation_id: conversationId },
            select: { id: true, user_id: true, left_at: true },
        });
        const activeCount = existing.filter((row) => row.left_at === null).length;
        const byUser = new Map(existing.map((row) => [row.user_id, row]));
        // Someone already in the group is a no-op, not an error; someone who
        // left earlier is re-added by clearing their `left_at` below.
        const toAdd = valid.filter((userId) => {
            const previous = byUser.get(userId);
            return !previous || previous.left_at !== null;
        });

        if (activeCount + toAdd.length > MAX_GROUP_PARTICIPANTS) {
            throw new BadRequestException(`A group holds at most ${MAX_GROUP_PARTICIPANTS} people.`);
        }

        const added: string[] = [];
        for (const userId of toAdd) {
            const previous = byUser.get(userId);
            if (previous) {
                // Rejoining: clear left_at rather than inserting a second row,
                // which the unique index would reject anyway.
                await this.db.chatParticipant.update({
                    where: { id: previous.id },
                    data: { left_at: null, joined_at: new Date(), last_read_at: null },
                });
            } else {
                await this.db.chatParticipant.create({
                    data: { conversation_id: conversationId, user_id: userId, role: 'member' },
                });
            }
            added.push(userId);
        }

        if (added.length > 0) {
            const names = await this.displayNames(added);
            await this.writeSystemMessage(viewer, conversationId, `added ${names.join(', ')}`);
        }

        return this.getConversation(viewer, conversationId);
    }

    async removeParticipant(viewer: ChatViewer, conversationId: string, targetUserId: string) {
        const membership = await this.access.requireMembership(viewer, conversationId);
        if (membership.kind !== 'group') {
            throw new BadRequestException('A direct message has no members to remove.');
        }

        // Anyone may remove themselves — that is "leave group". Removing someone
        // else is an admin action.
        const isSelf = targetUserId === viewer.userId;
        if (!isSelf) this.assertGroupAdmin(membership.role);

        const target = await this.db.chatParticipant.findFirst({
            where: { conversation_id: conversationId, user_id: targetUserId, left_at: null },
            select: { id: true },
        });
        if (!target) throw new NotFoundException('That person is not in this conversation.');

        await this.db.chatParticipant.update({
            where: { id: target.id },
            data: { left_at: new Date() },
        });

        await this.ensureGroupHasAdmin(conversationId);

        const names = await this.displayNames([targetUserId]);
        await this.writeSystemMessage(
            viewer,
            conversationId,
            isSelf ? 'left the group' : `removed ${names[0]}`,
        );

        // A leaver can no longer read the thread, so there is nothing to return.
        return isSelf ? { left: true } : this.getConversation(viewer, conversationId);
    }

    /* ------------------------------------------------------------------ */
    /*  Messages                                                           */
    /* ------------------------------------------------------------------ */

    async listMessages(viewer: ChatViewer, conversationId: string, query: ListMessagesDto) {
        await this.access.requireMembership(viewer, conversationId);

        const limit = Math.min(MAX_MESSAGE_PAGE, Math.max(1, query.limit ?? DEFAULT_MESSAGE_PAGE));

        // Cursor rather than offset: the thread grows while it is being read, and
        // an offset would skip or repeat rows every time a message arrives.
        let before: Date | undefined;
        if (query.before) {
            const anchor = await this.db.chatMessage.findFirst({
                where: { id: query.before, conversation_id: conversationId },
                select: { created_at: true },
            });
            if (!anchor) throw new BadRequestException('Unknown pagination cursor.');
            before = anchor.created_at;
        }

        const rows = await this.db.chatMessage.findMany({
            where: {
                conversation_id: conversationId,
                ...(before ? { created_at: { lt: before } } : {}),
            },
            orderBy: { created_at: 'desc' },
            take: limit + 1,
            select: MESSAGE_SELECT,
        });

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        return {
            // Returned oldest-first so the client renders top-to-bottom without
            // reversing; the cursor is the oldest id in the page.
            messages: page.slice().reverse().map((row) => this.mapMessage(row)),
            hasMore,
            nextCursor: hasMore ? page[page.length - 1].id : null,
        };
    }

    async sendMessage(viewer: ChatViewer, conversationId: string, dto: SendMessageDto) {
        const membership = await this.access.requireMembership(viewer, conversationId);
        if (membership.archivedAt) {
            throw new BadRequestException('This conversation is archived.');
        }

        const body = dto.body.trim();
        const uploads = dto.attachments ?? [];
        if (!body && uploads.length === 0) {
            throw new BadRequestException('Type a message or attach a file.');
        }

        // Uploads run first so a storage failure fails the send outright, rather
        // than leaving a message whose attachments quietly disappeared.
        const prepared = await this.attachments.prepare(viewer.tenantId, uploads);

        let message;
        try {
            message = await this.db.$transaction(async (tx) => {
                const created = await tx.chatMessage.create({
                    data: {
                        tenant_id: viewer.tenantId,
                        conversation_id: conversationId,
                        sender_id: viewer.userId,
                        body,
                        kind: 'text',
                        ...(prepared.length > 0
                            ? { attachments: { create: prepared } }
                            : {}),
                    },
                    select: MESSAGE_SELECT,
                });

                await tx.chatConversation.update({
                    where: { id: conversationId },
                    data: {
                        last_message_at: created.created_at,
                        last_message_preview: buildPreview(body, prepared.length),
                    },
                });

                // Sending is also reading: without this the sender's own message
                // comes back as unread on the next poll.
                await tx.chatParticipant.update({
                    where: { id: membership.participantId },
                    data: { last_read_at: created.created_at },
                });

                return created;
            });
        } catch (error) {
            await this.attachments.rollback(prepared);
            throw error;
        }

        await this.notifyRecipients(viewer, conversationId, body, prepared);

        return this.mapMessage(message);
    }

    async editMessage(viewer: ChatViewer, messageId: string, dto: EditMessageDto) {
        const message = await this.findOwnMessage(viewer, messageId);

        if (message.kind !== 'text') {
            throw new BadRequestException('That message cannot be edited.');
        }
        if (message.deleted_at) {
            throw new BadRequestException('That message was deleted.');
        }
        if (Date.now() - message.created_at.getTime() > CHAT_EDIT_WINDOW_MS) {
            throw new BadRequestException('That message is too old to edit.');
        }

        const body = dto.body.trim();
        if (!body) throw new BadRequestException('A message cannot be emptied by editing.');

        const updated = await this.db.chatMessage.update({
            where: { id: messageId },
            data: { body, edited_at: new Date() },
            select: MESSAGE_SELECT,
        });

        await this.refreshPreviewIfNewest(message.conversation_id, messageId, body);

        return this.mapMessage(updated);
    }

    async deleteMessage(viewer: ChatViewer, messageId: string) {
        const message = await this.findOwnMessage(viewer, messageId);
        if (message.deleted_at) return { deleted: true };

        // Files go first: a soft-deleted message keeps its place in the thread,
        // but there is no reason to keep paying to host something unreachable.
        await this.attachments.purgeForMessage(messageId);

        await this.db.chatMessage.update({
            where: { id: messageId },
            data: {
                deleted_at: new Date(),
                // Blanked, not merely hidden — a stored-but-hidden body is one
                // careless select away from being shown again.
                body: '',
            },
        });

        await this.refreshPreviewIfNewest(message.conversation_id, messageId, '');

        return { deleted: true };
    }

    async markRead(viewer: ChatViewer, conversationId: string) {
        const membership = await this.access.requireMembership(viewer, conversationId);
        await this.db.chatParticipant.update({
            where: { id: membership.participantId },
            data: { last_read_at: new Date() },
        });
        return { ok: true };
    }

    /**
     * Who the caller may start a conversation with: every other live member of
     * the workspace. Deliberately not filtered by store — a branch cashier and
     * the head-office accountant need to be able to reach each other.
     */
    async directory(viewer: ChatViewer) {
        const members = await this.db.tenantUser.findMany({
            where: { tenant_id: viewer.tenantId, user_id: { not: viewer.userId } },
            select: { role: true, user: { select: USER_SELECT } },
            orderBy: { user: { name: 'asc' } },
        });

        return members.map((member) => ({
            id: member.user.id,
            name: member.user.name,
            email: member.user.email,
            avatarUrl: member.user.avatar_url,
            role: member.role,
        }));
    }

    /* ------------------------------------------------------------------ */
    /*  Internals                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * A group whose last admin leaves would be unrenameable, unarchivable, and
     * impossible to add anyone to. The longest-standing remaining member takes
     * over rather than leaving the group stranded.
     */
    private async ensureGroupHasAdmin(conversationId: string) {
        const active = await this.db.chatParticipant.findMany({
            where: { conversation_id: conversationId, left_at: null },
            orderBy: { joined_at: 'asc' },
            select: { id: true, role: true },
        });
        if (active.length === 0) return;
        if (active.some((participant) => participant.role === 'admin')) return;

        await this.db.chatParticipant.update({
            where: { id: active[0].id },
            data: { role: 'admin' },
        });
    }

    private assertGroupAdmin(role: string) {
        if (role !== 'admin') {
            throw new ForbiddenException('Only a group admin can do that.');
        }
    }

    /**
     * Ownership, not membership, gates editing and deleting: chat has no
     * moderator role, so nobody edits or removes someone else's message.
     */
    private async findOwnMessage(viewer: ChatViewer, messageId: string) {
        const message = await this.db.chatMessage.findFirst({
            where: { id: messageId, tenant_id: viewer.tenantId },
            select: {
                id: true,
                conversation_id: true,
                sender_id: true,
                kind: true,
                body: true,
                deleted_at: true,
                created_at: true,
            },
        });
        // Membership is still required, so a message id guessed from another
        // conversation reveals nothing.
        if (!message) throw new NotFoundException('Message not found.');
        await this.access.requireMembership(viewer, message.conversation_id);

        if (message.sender_id !== viewer.userId) {
            throw new ForbiddenException('You can only change your own messages.');
        }
        return message;
    }

    /**
     * The conversation preview is denormalised, so editing or deleting the
     * newest message has to update it — otherwise the list keeps showing text
     * that no longer exists anywhere.
     */
    private async refreshPreviewIfNewest(
        conversationId: string,
        messageId: string,
        body: string,
    ) {
        const newest = await this.db.chatMessage.findFirst({
            where: { conversation_id: conversationId },
            orderBy: { created_at: 'desc' },
            select: { id: true, deleted_at: true },
        });
        if (newest?.id !== messageId) return;

        const attachmentCount = await this.db.chatAttachment.count({
            where: { message_id: messageId },
        });

        await this.db.chatConversation.update({
            where: { id: conversationId },
            data: {
                last_message_preview: newest.deleted_at
                    ? '[message deleted]'
                    : buildPreview(body, attachmentCount),
            },
        });
    }

    private async writeSystemMessage(viewer: ChatViewer, conversationId: string, text: string) {
        const actor = (await this.displayNames([viewer.userId]))[0];
        const body = `${actor} ${text}`;

        await this.db.$transaction(async (tx) => {
            const created = await tx.chatMessage.create({
                data: {
                    tenant_id: viewer.tenantId,
                    conversation_id: conversationId,
                    sender_id: viewer.userId,
                    body,
                    kind: 'system',
                },
                select: { created_at: true },
            });
            await tx.chatConversation.update({
                where: { id: conversationId },
                data: {
                    last_message_at: created.created_at,
                    last_message_preview: buildPreview(body),
                },
            });
        });
    }

    private async displayNames(userIds: string[]): Promise<string[]> {
        const users = await this.db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
        });
        const byId = new Map(users.map((user) => [user.id, user.name ?? user.email]));
        return userIds.map((id) => byId.get(id) ?? 'Someone');
    }

    /**
     * One in-app notification per recipient per message.
     *
     * Muted participants are skipped, and a failure here never fails the send —
     * the message is already committed, and a missing bell is not worth a 500.
     */
    private async notifyRecipients(
        viewer: ChatViewer,
        conversationId: string,
        body: string,
        prepared: PreparedAttachment[],
    ) {
        try {
            const conversation = await this.db.chatConversation.findUnique({
                where: { id: conversationId },
                select: {
                    kind: true,
                    title: true,
                    participants: {
                        where: {
                            left_at: null,
                            user_id: { not: viewer.userId },
                            OR: [{ muted_until: null }, { muted_until: { lt: new Date() } }],
                        },
                        select: { user_id: true },
                    },
                },
            });
            if (!conversation || conversation.participants.length === 0) return;

            const senderName = (await this.displayNames([viewer.userId]))[0];
            const title =
                conversation.kind === 'group'
                    ? `${senderName} in ${conversation.title ?? 'group'}`
                    : senderName;
            const preview = buildPreview(body, prepared.length);

            await Promise.all(
                conversation.participants.map((participant) =>
                    this.notifications.create(
                        viewer.tenantId,
                        participant.user_id,
                        'CHAT_MESSAGE',
                        title,
                        preview,
                        `/chat?conversation=${conversationId}`,
                    ),
                ),
            );
        } catch (error) {
            this.logger.error(`Failed to notify chat recipients: ${error}`);
        }
    }

    private mapMessage(row: {
        id: string;
        conversation_id: string;
        sender_id: string;
        body: string;
        kind: string;
        edited_at: Date | null;
        deleted_at: Date | null;
        created_at: Date;
        sender: { id: string; name: string | null; email: string; avatar_url: string | null };
        attachments: {
            id: string;
            file_url: string;
            file_name: string;
            mime_type: string;
            file_size: number | null;
        }[];
    }) {
        const deleted = row.deleted_at !== null;
        return {
            id: row.id,
            conversationId: row.conversation_id,
            kind: row.kind,
            // A deleted message keeps its slot so the thread does not reshuffle,
            // but carries no content of its own for the client to render.
            body: deleted ? '' : row.body,
            deleted,
            editedAt: row.edited_at,
            createdAt: row.created_at,
            sender: {
                id: row.sender.id,
                name: row.sender.name,
                email: row.sender.email,
                avatarUrl: row.sender.avatar_url,
            },
            attachments: deleted
                ? []
                : row.attachments.map((attachment) => ({
                      id: attachment.id,
                      url: attachment.file_url,
                      name: attachment.file_name,
                      mimeType: attachment.mime_type,
                      size: attachment.file_size,
                  })),
        };
    }
}
