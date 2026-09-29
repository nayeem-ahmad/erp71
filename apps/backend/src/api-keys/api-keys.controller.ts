import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    Body,
    Query,
    Request,
    UseGuards,
    UseInterceptors,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { PaginationDto } from '../common/pagination.dto';
import { ApiKeysService } from './api-keys.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { API_KEY_ADMIN } from '../auth/permission-sets';
class CreateApiKeyDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name: string;
}

@Controller('api-keys')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('apiAccess')
@UseInterceptors(TenantInterceptor)
export class ApiKeysController {
    constructor(private readonly apiKeysService: ApiKeysService) {}

    /**
     * GET /api-keys
     * List all API keys for the authenticated tenant.
     * Returns safe display fields only — never the raw key or its hash.
     */
    @RequireAnyStorePermission(...API_KEY_ADMIN)
    @Get()
    listKeys(@Tenant() tenant: TenantContext, @Query() query: PaginationDto) {
        return this.apiKeysService.listKeys(tenant.tenantId, query.page, query.limit);
    }

    /**
     * POST /api-keys
     * Generate a new API key for the authenticated tenant.
     * The full raw key is returned exactly once in this response.
     */
    @RequireAnyStorePermission(...API_KEY_ADMIN)
    @Post()
    @HttpCode(HttpStatus.CREATED)
    createKey(@Tenant() tenant: TenantContext, @Body() dto: CreateApiKeyDto) {
        return this.apiKeysService.createKey(tenant.tenantId, dto.name);
    }

    /**
     * DELETE /api-keys/:id
     * Revoke an API key by setting its revoked_at timestamp.
     */
    @RequireAnyStorePermission(...API_KEY_ADMIN)
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    revokeKey(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.apiKeysService.revokeKey(tenant.tenantId, id);
    }
}
