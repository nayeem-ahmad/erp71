import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { PERSON_SECTIONS, type MyPreferencesResponse, type PersonSectionKey } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { PreferencesService } from './preferences.service';

function personSection(section: string): PersonSectionKey {
    if (!(PERSON_SECTIONS as readonly string[]).includes(section)) {
        throw new BadRequestException(`Unknown preference section "${section}"`);
    }
    return section as PersonSectionKey;
}

/**
 * The signed-in member's own preferences. Deliberately no permission guard: every
 * route reads or writes only the caller's own membership.
 */
@Controller('preferences')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class PreferencesController {
    constructor(private readonly preferences: PreferencesService) {}

    @Get('me')
    async get(@Tenant() tenant: TenantContext): Promise<MyPreferencesResponse> {
        return this.preferences.resolveFor(tenant.tenantId, tenant.userId);
    }

    /**
     * The body is untyped on purpose: the service normalises each section, and a
     * DTO class would have the global whitelist pipe strip or reject its fields.
     */
    @Patch('me/:section')
    async save(
        @Tenant() tenant: TenantContext,
        @Param('section') section: string,
        @Body() body: unknown,
    ) {
        return this.preferences.saveSection(tenant.tenantId, tenant.userId, personSection(section), body);
    }

    @Delete('me/:section')
    async reset(@Tenant() tenant: TenantContext, @Param('section') section: string) {
        return this.preferences.resetSection(tenant.tenantId, tenant.userId, personSection(section));
    }
}
