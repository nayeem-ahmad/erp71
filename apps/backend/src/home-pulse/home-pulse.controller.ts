import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchQueryDto } from '../common/branch-query.dto';
import { HomePulseService } from './home-pulse.service';

/**
 * The Home app tiles. No permission guard on purpose: every metric is gated
 * by its own module's permission inside the service, so a member who can open
 * a single module still gets that module's count instead of a 403.
 */
@Controller('home')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class HomePulseController {
    constructor(private readonly pulse: HomePulseService) {}

    @Get('pulse')
    async getPulse(@Tenant() tenant: TenantContext, @Query() query: BranchQueryDto) {
        return this.pulse.getPulse(tenant, query.storeId);
    }
}
