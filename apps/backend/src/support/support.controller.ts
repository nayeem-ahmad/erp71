import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DatabaseService } from '../database/database.service';
import { SupportService } from './support.service';
import { KNOCK_CATEGORIES, threadCategoryWhere } from './support.util';

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

        return { id: message.id };
    }
}
