import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    Req,
    Res,
    UseGuards,
    UseInterceptors,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DatabaseService } from '../database/database.service';
import { SupportService } from './support.service';
import { KNOCK_CATEGORIES, threadCategoryWhere } from './support.util';
import { SupportEventsService, formatSseFrame, sseHeartbeat } from './support-events.service';

/** How often an idle stream writes a comment frame, to outlive proxy read timeouts. */
const STREAM_HEARTBEAT_MS = 25_000;

/**
 * How long one connection lives before the client is made to reconnect. Keeps
 * an open stream from outliving the session that opened it, and gives a
 * long-lived tab a natural point to pick up a renewed token.
 */
const STREAM_MAX_MS = 10 * 60_000;

class CreateThreadDto {
    @IsOptional()
    @IsString()
    @IsIn([...KNOCK_CATEGORIES])
    category?: string;

    @IsOptional()
    @IsString()
    @MinLength(3)
    @MaxLength(200)
    subject?: string;

    @IsString()
    @MinLength(3)
    body: string;

    @IsOptional()
    @IsString()
    page?: string;
}

class SendMessageDto {
    @IsString()
    @MinLength(1)
    body: string;
}

@Controller('support')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SupportController {
    constructor(
        private readonly db: DatabaseService,
        private readonly support: SupportService,
        private readonly events: SupportEventsService,
    ) {}

    /**
     * The shop's own conversations. `search`, `status` and `category` narrow the
     * list server-side rather than in the browser: a shop that has been writing
     * in for a year has more threads than the list ever renders at once, and
     * filtering the rendered page would only ever search what had already
     * arrived. Search covers message bodies as well as the subject — a subject
     * is derived from the first 80 characters of the first message, so the
     * words someone remembers are often further in.
     */
    @Get('threads')
    async listThreads(
        @Tenant() tenant: TenantContext,
        @Query('search') search?: string,
        @Query('status') status?: string,
        @Query('category') category?: string,
    ) {
        await this.support.assertInboxEnabled(tenant.tenantId);

        const where: any = {
            tenantId: tenant.tenantId,
            ...threadCategoryWhere(category),
        };
        if (status && ['open', 'resolved'].includes(status)) where.status = status;
        const term = search?.trim();
        if (term) {
            where.OR = [
                { subject: { contains: term, mode: 'insensitive' } },
                { messages: { some: { body: { contains: term, mode: 'insensitive' } } } },
            ];
        }

        const threads = await this.db.supportThread.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            include: {
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { body: true, senderRole: true, createdAt: true },
                },
                _count: { select: { messages: true } },
            },
        });

        return threads.map((t) => ({
            id: t.id,
            ticketNumber: t.ticketNumber,
            subject: t.subject,
            status: t.status,
            category: t.category,
            page: t.page,
            feedbackId: t.feedbackId,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            messageCount: t._count.messages,
            lastMessage: t.messages[0] ?? null,
        }));
    }

    /**
     * Live thread changes for this workspace, as Server-Sent Events.
     *
     * Written to the raw response rather than through Nest's `@Sse()` because
     * the app registers `TransformInterceptor` globally: it maps every emitted
     * value into a `{ data }` envelope, which for an SSE observable would nest
     * the payload one level deeper and lose the event name. A library-specific
     * response is left alone by that interceptor, so the frames on the wire are
     * exactly the ones written here.
     *
     * Each frame is only a nudge — the client re-reads the thread over the
     * endpoints above — so a missed event costs nothing but a slower update,
     * which is what the client's fallback poll is for.
     */
    @Get('stream')
    async stream(
        @Tenant() tenant: TenantContext,
        @Req() req: Request,
        @Res() res: Response,
    ): Promise<void> {
        // Throws before a byte is written when the feature is off, so the
        // failure arrives as an ordinary JSON error rather than an empty stream.
        await this.support.assertInboxEnabled(tenant.tenantId);

        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            // `no-transform` asks intermediaries not to compress the stream —
            // a buffering gzip in front of this would delay every event.
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            // nginx-specific, harmless elsewhere: never buffer this response.
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        // Say hello immediately: the client treats the first frame as "connected"
        // and drops to a slow safety-net poll only once it arrives.
        res.write(formatSseFrame('ready', { at: new Date().toISOString() }));

        const subscription = this.events.forTenant(tenant.tenantId).subscribe((event) => {
            res.write(formatSseFrame(event.kind, event));
        });

        await new Promise<void>((resolve) => {
            // Idempotent, and it has to be: ending the response emits `close`,
            // which lands back here. Without the latch, the timeout below would
            // end an already-finished response and take the process with it.
            let closed = false;
            const close = () => {
                if (closed) return;
                closed = true;
                clearInterval(heartbeat);
                clearTimeout(expiry);
                subscription.unsubscribe();
                res.end();
                resolve();
            };

            const heartbeat = setInterval(() => res.write(sseHeartbeat()), STREAM_HEARTBEAT_MS);
            // The guard runs once, at connect, so an open stream is a credential
            // that never re-checks itself. Capping its life bounds that: the
            // client reconnects with whatever token it holds *then*, and a
            // session that has since ended stops being able to listen.
            const expiry = setTimeout(close, STREAM_MAX_MS);

            // `close` on the response covers the tab going away and the cap
            // above; on the request, an abandoned socket.
            res.on('close', close);
            req.on('close', close);
            req.on('error', close);

            // A client that gave up before the listeners went on has already
            // had its event; without this the subscription and the heartbeat
            // would outlive it with nothing left to fire them.
            if (res.writableEnded || req.destroyed) close();
        });
    }

    @Post('threads')
    async createThread(@Tenant() tenant: TenantContext, @Body() dto: CreateThreadDto) {
        return this.support.createKnock({
            tenantId: tenant.tenantId,
            userId: tenant.userId,
            category: dto.category ?? 'support',
            subject: dto.subject,
            body: dto.body,
            page: dto.page,
        });
    }

    @Get('threads/:id/messages')
    async getMessages(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        await this.support.assertInboxEnabled(tenant.tenantId);
        const thread = await this.db.supportThread.findUnique({ where: { id } });
        if (!thread) throw new NotFoundException('Thread not found');
        if (thread.tenantId !== tenant.tenantId) throw new ForbiddenException();

        const messages = await this.db.supportMessage.findMany({
            where: { threadId: id },
            orderBy: { createdAt: 'asc' },
            include: { sender: { select: { name: true, email: true } } },
        });

        return {
            thread: {
                id: thread.id,
                ticketNumber: thread.ticketNumber,
                subject: thread.subject,
                status: thread.status,
                category: thread.category,
                page: thread.page,
                feedbackId: thread.feedbackId,
            },
            messages: messages.map((m) => ({
                id: m.id,
                senderRole: m.senderRole,
                senderName: m.sender.name ?? m.sender.email,
                body: m.body,
                createdAt: m.createdAt,
            })),
        };
    }

    @Post('threads/:id/messages')
    async sendMessage(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: SendMessageDto,
    ) {
        await this.support.assertInboxEnabled(tenant.tenantId);
        const thread = await this.db.supportThread.findUnique({ where: { id } });
        if (!thread) throw new NotFoundException('Thread not found');
        if (thread.tenantId !== tenant.tenantId) throw new ForbiddenException();
        if (thread.status === 'resolved') throw new ForbiddenException('Thread is resolved');

        const message = await this.db.supportMessage.create({
            data: {
                threadId: id,
                senderId: tenant.userId,
                senderRole: 'owner',
                body: dto.body,
            },
        });

        await this.db.supportThread.update({
            where: { id },
            data: { updatedAt: new Date() },
        });

        // The workspace's other open tabs — a second till, the owner's phone —
        // are watching the stream for this.
        this.events.publish({
            kind: 'message',
            tenantId: thread.tenantId,
            threadId: thread.id,
            ticketNumber: thread.ticketNumber,
            status: thread.status,
            actor: 'owner',
        });

        return { id: message.id };
    }
}
