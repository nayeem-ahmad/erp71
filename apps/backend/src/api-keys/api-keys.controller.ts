import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    Body,
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
import { ApiKeysService } from './api-keys.service';

class CreateApiKeyDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name: string;
}

@Controller('api-keys')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class ApiKeysController {
    constructor(private readonly apiKeysService: ApiKeysService) {}

    /**
     * GET /api-keys
     * List all API keys for the authenticated tenant.
     * Returns safe display fields only — never the raw key or its hash.
     */
    @Get()
    listKeys(@Tenant() tenant: TenantContext) {
        return this.apiKeysService.listKeys(tenant.tenantId);
    }

    /**
     * POST /api-keys
     * Generate a new API key for the authenticated tenant.
     * The full raw key is returned exactly once in this response.
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    createKey(@Tenant() tenant: TenantContext, @Body() dto: CreateApiKeyDto) {
        return this.apiKeysService.createKey(tenant.tenantId, dto.name);
    }

    /**
     * DELETE /api-keys/:id
     * Revoke an API key by setting its revoked_at timestamp.
     */
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    revokeKey(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.apiKeysService.revokeKey(tenant.tenantId, id);
    }
}
