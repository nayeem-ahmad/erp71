import {
    Controller,
    Get,
    Post,
    Patch,
    Body,
    Param,
    Query,
    UseGuards,
    NotFoundException,
    Request,
} from '@nestjs/common';
import { IsString, MinLength, IsIn, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { DatabaseService } from '../database/database.service';

class AdminSendMessageDto {
    @IsString()
    @MinLength(1)
    body: string;
}

class UpdateThreadDto {
    @IsString()
    @IsIn(['open', 'resolved'])
    @IsOptional()
    status?: string;
}

@Controller('admin/support')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminSupportController {
    constructor(private readonly db: DatabaseService) {}

    @Get('threads')
    async listThreads(
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const take = Math.min(Number(limit) || 50, 100);
        const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

        const where: any = {};
        if (status && ['open', 'resolved'].includes(status)) where.status = status;
        if (search) where.subject = { contains: search, mode: 'insensitive' };

        const [data, total] = await Promise.all([
            this.db.supportThread.findMany({
                where,
                skip,
                take,
                orderBy: { updatedAt: 'desc' },
                include: {
                    tenant: { select: { name: true } },
                    messages: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        select: { body: true, senderRole: true, createdAt: true },
                    },
                    _count: { select: { messages: true } },
                },
            }),
            this.db.supportThread.count({ where }),
        ]);

        return {
            data: data.map((t) => ({
                id: t.id,
                subject: t.subject,
                status: t.status,
                tenant: t.tenant.name,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
                messageCount: t._count.messages,
                lastMessage: t.messages[0] ?? null,
            })),
            total,
            page: Math.max(Number(page) || 1, 1),
            limit: take,
        };
    }

    @Get('threads/:id/messages')
    async getMessages(@Param('id') id: string) {
        const thread = await this.db.supportThread.findUnique({
            where: { id },
            include: { tenant: { select: { name: true } } },
        });
        if (!thread) throw new NotFoundException('Thread not found');

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
                tenant: thread.tenant.name,
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
        @Param('id') id: string,
        @Body() dto: AdminSendMessageDto,
        @Request() req: any,
    ) {
        const thread = await this.db.supportThread.findUnique({ where: { id } });
        if (!thread) throw new NotFoundException('Thread not found');

        const message = await this.db.supportMessage.create({
            data: {
                threadId: id,
                senderId: req.user.userId,
                senderRole: 'admin',
                body: dto.body,
            },
        });

        await this.db.supportThread.update({
            where: { id },
            data: { updatedAt: new Date(), status: 'open' },
        });

        return { id: message.id };
    }

    @Patch('threads/:id')
    async updateThread(@Param('id') id: string, @Body() dto: UpdateThreadDto) {
        const thread = await this.db.supportThread.findUnique({ where: { id } });
        if (!thread) throw new NotFoundException('Thread not found');

        const updated = await this.db.supportThread.update({
            where: { id },
            data: { ...(dto.status && { status: dto.status }) },
        });

        return { id: updated.id, status: updated.status };
    }
}
