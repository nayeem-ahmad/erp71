import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CrmLeadTaxonomyService } from './crm-lead-taxonomy.service';
import {
    CreateLeadTaxonomyDto,
    DeleteLeadTaxonomyDto,
    LeadTaxonomyKind,
    ListLeadTaxonomyDto,
    UpdateLeadTaxonomyDto,
} from './lead-taxonomy.dto';

const KINDS = Object.values(LeadTaxonomyKind) as string[];

/** Rejects any path segment that is not one of the known lists. */
function parseKind(kind: string): LeadTaxonomyKind {
    if (!KINDS.includes(kind)) throw new BadRequestException('Unsupported CRM setup list.');
    return kind as LeadTaxonomyKind;
}

@Controller('crm/lead-taxonomy')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class CrmLeadTaxonomyController {
    constructor(private readonly service: CrmLeadTaxonomyService) {}

    /**
     * Readable by anyone who can see leads — the lead form, the log-conversation
     * form and the list filters all need it. Only the mutations require
     * MANAGE_CRM_SETTINGS.
     */
    @Get(':kind')
    list(
        @Tenant() tenant: TenantContext,
        @Param('kind') kind: string,
        @Query() query: ListLeadTaxonomyDto,
    ) {
        return this.service.list(tenant.tenantId, parseKind(kind), query.includeInactive);
    }

    @Get(':kind/usage')
    @RequireStorePermission(StorePermission.MANAGE_CRM_SETTINGS)
    usage(@Tenant() tenant: TenantContext, @Param('kind') kind: string) {
        return this.service.usage(tenant.tenantId, parseKind(kind));
    }

    @Post(':kind')
    @RequireStorePermission(StorePermission.MANAGE_CRM_SETTINGS)
    create(
        @Tenant() tenant: TenantContext,
        @Param('kind') kind: string,
        @Body() dto: CreateLeadTaxonomyDto,
    ) {
        return this.service.create(tenant.tenantId, parseKind(kind), dto);
    }

    @Patch(':kind/:id')
    @RequireStorePermission(StorePermission.MANAGE_CRM_SETTINGS)
    update(
        @Tenant() tenant: TenantContext,
        @Param('kind') kind: string,
        @Param('id') id: string,
        @Body() dto: UpdateLeadTaxonomyDto,
    ) {
        return this.service.update(tenant.tenantId, parseKind(kind), id, dto);
    }

    @Delete(':kind/:id')
    @RequireStorePermission(StorePermission.MANAGE_CRM_SETTINGS)
    remove(
        @Tenant() tenant: TenantContext,
        @Param('kind') kind: string,
        @Param('id') id: string,
        @Query() query: DeleteLeadTaxonomyDto,
    ) {
        return this.service.remove(tenant.tenantId, parseKind(kind), id, query.reassignTo);
    }
}
