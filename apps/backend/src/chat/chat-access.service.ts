import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface ChatViewer {
    tenantId: string;
    userId: string;
}

export interface ChatMembership {
    conversationId: string;
    kind: string;
    title: string | null;
    archivedAt: Date | null;
    /** The caller's own participant row — never anyone else's. */
    participantId: string;
    role: string;
    lastReadAt: Date | null;
    mutedUntil: Date | null;
}

/**
 * The single gate for every chat read and write.
 *
 * Chat is the one module in this codebase where scoping a query to `tenant_id`
 * is *not* the whole access rule. Everywhere else an OWNER may see anything
 * their workspace holds, and `StorePermissionGuard` short-circuits to `true`
 * for them. Staff DMs are private, so membership is the only rule here and it
 * has no role bypass: an OWNER who is not a participant is not a reader.
 *
 * The failure is deliberately `NotFoundException` and never `ForbiddenException`
 * — a 403 would confirm that a conversation with that id exists, which is
 * already more than a non-participant should learn.
 */
@Injectable()
export class ChatAccessService {
    constructor(private readonly db: DatabaseService) {}

    async requireMembership(viewer: ChatViewer, conversationId: string): Promise<ChatMembership> {
        const participant = await this.db.chatParticipant.findFirst({
            where: {
                conversation_id: conversationId,
                user_id: viewer.userId,
                // A member who left a group keeps their row so their old messages
                // still resolve to a name, but reads nothing from then on.
                left_at: null,
                // Tenant is still checked, so a stale `x-tenant-id` cannot be used
                // to reach a conversation through a membership in another one.
                conversation: { tenant_id: viewer.tenantId },
            },
            select: {
                id: true,
                role: true,
                last_read_at: true,
                muted_until: true,
                conversation: {
                    select: { id: true, kind: true, title: true, archived_at: true },
                },
            },
        });

        if (!participant) {
            throw new NotFoundException('Conversation not found.');
        }

        return {
            conversationId: participant.conversation.id,
            kind: participant.conversation.kind,
            title: participant.conversation.title,
            archivedAt: participant.conversation.archived_at,
            participantId: participant.id,
            role: participant.role,
            lastReadAt: participant.last_read_at,
            mutedUntil: participant.muted_until,
        };
    }

    /** Active member ids, for fan-out (notifications, system messages). */
    async listActiveParticipantIds(conversationId: string): Promise<string[]> {
        const rows = await this.db.chatParticipant.findMany({
            where: { conversation_id: conversationId, left_at: null },
            select: { user_id: true },
        });
        return rows.map((row) => row.user_id);
    }

    /**
     * Whether every id is a live member of this workspace. Used before opening a
     * DM or adding someone to a group — a user id from another tenant must never
     * become a participant, or the conversation straddles two workspaces.
     */
    async filterTenantMemberIds(tenantId: string, userIds: string[]): Promise<string[]> {
        if (userIds.length === 0) return [];
        const rows = await this.db.tenantUser.findMany({
            where: { tenant_id: tenantId, user_id: { in: userIds } },
            select: { user_id: true },
        });
        return rows.map((row) => row.user_id);
    }
}
