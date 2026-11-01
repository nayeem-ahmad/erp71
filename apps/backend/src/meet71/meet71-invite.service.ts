import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { isEmail } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

export type Meet71InviteInput = {
    email: string;
    actorEmail: string;
    resend?: boolean;
    unlimited?: boolean;
};

export type Meet71InviteResult = {
    email: string;
    invitesRemaining: number;
    emailSent: boolean;
    resent?: boolean;
};

type MemberRow = {
    display_name: string | null;
    invite_quota: number;
    invites_used: number;
};

@Injectable()
export class Meet71InviteService {
    private readonly logger = new Logger(Meet71InviteService.name);

    constructor(
        private db: DatabaseService,
        private email: EmailService,
        private audit: AuditService,
    ) {}

    async invite(input: Meet71InviteInput): Promise<Meet71InviteResult> {
        const raw = (input.email ?? '').trim();
        if (raw.startsWith('@') || !isEmail(raw)) {
            throw new BadRequestException({
                code: 'MEET71_INVITE_NOT_EMAIL',
                message: 'Invite an email address, not a domain pattern.',
            });
        }

        const email = raw.toLowerCase();
        const actorEmail = (input.actorEmail ?? '').trim().toLowerCase();
        const resend = Boolean(input.resend);
        const unlimited = Boolean(input.unlimited);

        const committed = await this.db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Meet71Member" WHERE email = ${actorEmail} FOR UPDATE`;
            const actor = await tx.meet71Member.findUnique({ where: { email: actorEmail } });

            const deny = await tx.meet71DenyEntry.findUnique({ where: { email } });
            if (deny) {
                throw new ForbiddenException({
                    code: 'MEET71_DENIED',
                    message: 'This email is blocked on Meet71.',
                });
            }

            const existing = await tx.meet71Member.findUnique({ where: { email } });
            if (existing && resend) {
                return {
                    resent: true as const,
                    invitesRemaining: remainingOf(actor),
                    inviterName: inviterNameOf(actor, actorEmail),
                };
            }
            if (existing) {
                throw new ConflictException({
                    code: 'MEET71_ALREADY_MEMBER',
                    message: 'This email is already a Meet71 member.',
                });
            }

            if (
                !unlimited &&
                (actor == null || (actor.invite_quota !== -1 && actor.invites_used >= actor.invite_quota))
            ) {
                throw new ForbiddenException({
                    code: 'MEET71_INVITE_CAP',
                    message: 'Invite quota reached.',
                });
            }

            await tx.meet71AllowEntry.upsert({
                where: { pattern: email },
                create: { pattern: email, kind: 'EMAIL', created_by: actorEmail || null },
                update: {},
            });
            await tx.meet71Member.create({
                data: {
                    email,
                    can_create_room: false,
                    invite_quota: 0,
                    is_admin: false,
                    invited_by_email: actorEmail || null,
                },
            });

            let invitesRemaining = remainingOf(actor);
            if (actor && !unlimited) {
                const updated = await tx.meet71Member.update({
                    where: { email: actorEmail },
                    data: { invites_used: { increment: 1 } },
                });
                invitesRemaining = remainingOf(updated);
            } else if (!actor && unlimited) {
                invitesRemaining = -1;
            }

            return {
                resent: false as const,
                invitesRemaining,
                inviterName: inviterNameOf(actor, actorEmail),
            };
        });

        let emailSent = true;
        try {
            await this.email.sendMeet71Invite(email, committed.inviterName);
        } catch (err) {
            this.logger.warn(`Meet71 invite mail failed to=${email}: ${err}`);
            emailSent = false;
        }

        await this.audit.log('MEET71_INVITE', 'Meet71Member', { tenantId: undefined }, email, {
            email,
            actorEmail,
            resent: committed.resent,
            emailSent,
            invitesRemaining: committed.invitesRemaining,
        });
        this.logger.log(
            `Meet71 invite actor=${actorEmail} to=${email} remaining=${committed.invitesRemaining} emailSent=${emailSent}`,
        );

        return {
            email,
            invitesRemaining: committed.invitesRemaining,
            emailSent,
            ...(committed.resent ? { resent: true } : {}),
        };
    }
}

function remainingOf(member: MemberRow | null): number {
    if (!member) return 0;
    return member.invite_quota === -1 ? -1 : Math.max(0, member.invite_quota - member.invites_used);
}

function inviterNameOf(member: MemberRow | null, actorEmail: string): string {
    const name = member?.display_name?.trim();
    return name || actorEmail;
}
