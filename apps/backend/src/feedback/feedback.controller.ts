import { Controller, Post, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { IsEnum, IsString, IsOptional, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { SupportService } from '../support/support.service';

enum FeedbackType {
    bug = 'bug',
    feature = 'feature',
    general = 'general',
}

class CreateFeedbackDto {
    @IsEnum(FeedbackType)
    type: FeedbackType;

    @IsString()
    @MinLength(3)
    message: string;

    @IsString()
    @IsOptional()
    page?: string;
}

@Controller('feedback')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class FeedbackController {
    constructor(private readonly support: SupportService) {}

    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateFeedbackDto) {
        const knock = await this.support.createKnock({
            tenantId: tenant.tenantId,
            userId: tenant.userId,
            category: dto.type,
            body: dto.message,
            page: dto.page,
        });
        return { id: knock.feedbackId ?? knock.id, threadId: knock.id };
    }
}
