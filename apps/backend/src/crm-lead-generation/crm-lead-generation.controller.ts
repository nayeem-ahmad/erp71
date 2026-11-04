import { Body, Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CRM_WRITE } from '../auth/permission-sets';
import { CrmLeadGenerationService } from './crm-lead-generation.service';
import { ImportLeadGenerationDto, SearchLeadGenerationDto } from './crm-lead-generation.dto';

@ApiTags('crm-lead-generation')
@ApiBearerAuth()
@Controller('crm/lead-generation')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmLeadGenerationController {
    constructor(private readonly service: CrmLeadGenerationService) {}

    @RequireAnyStorePermission(...CRM_WRITE)
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @Post('search')
    search(@Tenant() tenant: TenantContext, @Body() dto: SearchLeadGenerationDto) {
        return this.service.search(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    @Post('import')
    importCandidates(@Tenant() tenant: TenantContext, @Body() dto: ImportLeadGenerationDto) {
        return this.service.importCandidates(tenant.tenantId, tenant.userId, tenant.timezone, dto.candidates);
    }
}
