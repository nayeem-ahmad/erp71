import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    UseInterceptors,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DatabaseService } from '../database/database.service';

class CreateThreadDto {
    @IsString()
    @MinLength(3)
    @MaxLength(200)
    subject: string;

    @IsString()
    @MinLength(3)
    body: string;
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
    constructor(private readonly db: DatabaseService) {}

    @Get('threads')
    async listThreads(@Tenant() tenant: TenantContext) {
        const threads = await this.db.supportThread.findMany({
            where: { tenantId: tenant.tenantId },
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
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            messageCount: t._count.messages,
            lastMessage: t.messages[0] ?? null,
        }));
    }

    @Post('threads')
    async createThread(@Tenant() tenant: TenantContext, @Body() dto: CreateThreadDto) {
        const thread = await this.db.supportThread.create({
            data: {
                tenantId: tenant.tenantId,
                subject: dto.subject,
                messages: {
                    create: {
                        senderId: tenant.userId,
                        senderRole: 'owner',
                        body: dto.body,
                    },
                },
            },
        });
        return { id: thread.id };
    }

    @Get('threads/:id/messages')
    async getMessages(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const thread = await this.db.supportThread.findUnique({ where: { id } });
        if (!thread) throw new NotFoundException('Thread not found');
        if (thread.tenantId !== tenant.tenantId) throw new ForbiddenException();

        const messages = await this.db.supportMessage.findMany({
            where: { threadId: id },
            orderBy: { createdAt: 'asc' },
            include: { sender: { select: { name: true, email: true } } },
        });

        return {
            thread: { id: thread.id, subject: thread.subject, status: thread.status },
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
