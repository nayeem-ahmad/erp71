import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { NpsService } from './nps.service';
import { SubmitNpsDto, SubmitPlatformNpsDto } from './nps.dto';

/**
 * The receipt survey a shop's customer answers. No guard and no
 * TenantInterceptor: the unguessable code is the authorisation, as with a
 * shared meeting. Throttled, because it is reachable by anyone with a link.
 */
@Controller('public/nps')
@Throttle({ default: { ttl: 60_000, limit: 20 } })
export class PublicNpsController {
    constructor(private readonly nps: NpsService) {}

    @Get(':code')
    get(@Param('code') code: string) {
        return this.nps.getPublicSurvey(code);
    }

    @Post(':code')
    submit(@Param('code') code: string, @Body() dto: SubmitNpsDto) {
        return this.nps.submitPublic(code, dto.score, dto.comment);
    }
}

/**
 * The in-app question to a shop owner: how likely are they to recommend
 * ERP71. Self-scoped — it reads and writes only the signed-in owner's own
 * answer — and the service refuses anyone who is not the owner.
 */
@Controller('nps/platform')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class OwnerNpsController {
    constructor(private readonly nps: NpsService) {}

    @Get('prompt')
    prompt(@Tenant() tenant: TenantContext) {
        return this.nps.shouldAskOwner({ userId: tenant.userId, tenantId: tenant.tenantId, role: tenant.userRole });
    }

    @Post()
    submit(@Tenant() tenant: TenantContext, @Body() dto: SubmitPlatformNpsDto) {
        return this.nps.submitOwner({ userId: tenant.userId, tenantId: tenant.tenantId, role: tenant.userRole }, dto);
    }
}
