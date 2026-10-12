import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AllowPlatformRoles } from '../auth/platform-roles.decorator';
import { PlatformRole } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';

@Controller('admin/feedback')
@AllowPlatformRoles(PlatformRole.SUPPORT_ENGINEER)
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminFeedbackController {
    constructor(private readonly db: DatabaseService) {}

    @Get()
    async list(
        @Query('type') type?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const take = Math.min(Number(limit) || 50, 100);
        const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

        const where: any = {};
        if (type && ['bug', 'feature', 'general'].includes(type)) {
            where.type = type;
        }
        if (search) {
            where.message = { contains: search, mode: 'insensitive' };
        }

        const [data, total] = await Promise.all([
            this.db.feedback.findMany({
                where,
                skip,
                take,
                orderBy: { createdAt: 'desc' },
                include: {
                    tenant: { select: { name: true } },
                    user: { select: { email: true, name: true } },
                },
            }),
            this.db.feedback.count({ where }),
        ]);

        return {
            data: data.map((f) => ({
                id: f.id,
                type: f.type,
                message: f.message,
                page: f.page,
                createdAt: f.createdAt,
                tenant: f.tenant.name,
                userEmail: f.user.email,
                userName: f.user.name,
            })),
            total,
            page: Math.max(Number(page) || 1, 1),
            limit: take,
        };
    }
}
