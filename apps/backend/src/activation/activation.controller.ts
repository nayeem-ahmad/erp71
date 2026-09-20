import { Body, Controller, Get, Param, Post, Query, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AllowWhenSuspended } from '../auth/billing-suspension.decorator';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { ActivationService } from './activation.service';
import {
    CreateActivationRequestDto,
    ListActivationRequestsDto,
    RejectActivationRequestDto,
    ReviewActivationRequestDto,
} from './activation.dto';

/**
 * The tenant's half of manual activation: what they owe, where to send it, and
 * the receipt they submit afterwards.
 *
 * `@AllowWhenSuspended` on the submit route because a suspended workspace paying
 * its way out is exactly the case this exists for — leaving it blocked would
 * make the suspension unliftable by the only person who can lift it.
 */
@Controller('activation')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class ActivationController {
    constructor(private readonly activation: ActivationService) {}

    @Get('status')
    getStatus(@Tenant() tenant: TenantContext) {
        return this.activation.getStatus(tenant);
    }

    /**
     * Tighter than the surrounding API: a submission is read by a human, so the
     * useful rate is a handful an hour, and a loose budget here is a queue an
     * admin has to wade through.
     */
    @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
    @AllowWhenSuspended()
    @Post('requests')
    submitRequest(@Tenant() tenant: TenantContext, @Body() dto: CreateActivationRequestDto) {
        return this.activation.submitRequest(tenant, dto);
    }
}

/** The platform team's review queue. Platform admins only — approving posts money. */
@Controller('admin/activation-requests')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminActivationController {
    constructor(private readonly activation: ActivationService) {}

    @Get()
    list(@Query() query: ListActivationRequestsDto) {
        return this.activation.listRequests(query.status);
    }

    @Post(':id/approve')
    approve(@Param('id') id: string, @Body() dto: ReviewActivationRequestDto, @Request() req: any) {
        return this.activation.approve(id, req.user.userId, dto);
    }

    @Post(':id/reject')
    reject(@Param('id') id: string, @Body() dto: RejectActivationRequestDto, @Request() req: any) {
        return this.activation.reject(id, req.user.userId, dto);
    }
}
