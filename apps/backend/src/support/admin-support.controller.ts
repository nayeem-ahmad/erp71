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
import { threadCategoryWhere } from './support.util';

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

    /**
     * Options for the inbox's tenant/user dropdowns. Derived from the threads
     * themselves rather than the full tenant/user tables — the platform has far
     * more of both than have ever written in, and a dropdown of every user on
     * the platform would be unusable. Pass `tenantId` to narrow the user list to
     * that tenant's people.
     */
    @Get('filters')
    async filterOptions(@Query('tenantId') tenantId?: string) {
        const [tenantGroups, userGroups] = await Promise.all([
            this.db.supportThread.groupBy({
                by: ['tenantId'],
                _count: { _all: true },
            }),
            this.db.supportThread.groupBy({
                by: ['createdById'],
                where: {
                    createdById: { not: null },
                    ...(tenantId ? { tenantId } : {}),
                },
                _count: { _all: true },
            }),
        ]);

        const tenantIds = tenantGroups.map((g) => g.tenantId);
        const userIds = userGroups
            .map((g) => g.createdById)
            .filter((v): v is string => v !== null);

        const [tenants, users] = await Promise.all([
            tenantIds.length
                ? this.db.tenant.findMany({
                      where: { id: { in: tenantIds } },
                      select: { id: true, name: true },
                  })
                : Promise.resolve([]),
            userIds.length
                ? this.db.user.findMany({
                      where: { id: { in: userIds } },
                      select: { id: true, name: true, email: true },
                  })
                : Promise.resolve([]),
        ]);

        const tenantCounts = new Map(tenantGroups.map((g) => [g.tenantId, g._count._all]));
        const userCounts = new Map(userGroups.map((g) => [g.createdById, g._count._all]));

        return {
            tenants: tenants
                .map((t) => ({ id: t.id, name: t.name, threadCount: tenantCounts.get(t.id) ?? 0 }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            users: users
                .map((u) => ({
                    id: u.id,
                    name: u.name ?? u.email,
                    email: u.email,
                    threadCount: userCounts.get(u.id) ?? 0,
                }))
                .sort((a, b) => a.name.localeCompare(b.name)),
        };
    }

    @Get('threads')
    async listThreads(
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('category') category?: string,
        @Query('kind') kind?: string,
        @Query('tenantId') tenantId?: string,
        @Query('userId') userId?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const take = Math.min(Number(limit) || 50, 100);
        const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

        const where: any = {
            ...threadCategoryWhere(category, kind),
        };
        if (status && ['open', 'resolved'].includes(status)) where.status = status;
        if (search) where.subject = { contains: search, mode: 'insensitive' };
        if (tenantId) where.tenantId = tenantId;
        if (userId) where.createdById = userId;

        const [data, total] = await Promise.all([
            this.db.supportThread.findMany({
                where,
                skip,
                take,
                orderBy: { updatedAt: 'desc' },
                include: {
                    tenant: { select: { name: true } },
                    createdBy: { select: { id: true, name: true, email: true } },
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
                category: t.category,
                page: t.page,
                feedbackId: t.feedbackId,
                tenantId: t.tenantId,
                tenant: t.tenant.name,
                createdBy: t.createdBy && {
                    id: t.createdBy.id,
                    name: t.createdBy.name ?? t.createdBy.email,
                    email: t.createdBy.email,
                },
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
            include: {
                tenant: { select: { name: true } },
                createdBy: { select: { id: true, name: true, email: true } },
            },
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
                category: thread.category,
                page: thread.page,
                feedbackId: thread.feedbackId,
                tenantId: thread.tenantId,
                tenant: thread.tenant.name,
                createdBy: thread.createdBy && {
                    id: thread.createdBy.id,
                    name: thread.createdBy.name ?? thread.createdBy.email,
                    email: thread.createdBy.email,
                },
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
