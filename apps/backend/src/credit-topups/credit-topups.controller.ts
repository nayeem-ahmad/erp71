import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Request,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { CreditTopupService } from './credit-topup.service';
import {
    ApproveCreditTopupRequestDto,
    CreateCreditPackageDto,
    CreateCreditTopupRequestDto,
    ListCreditTopupRequestsDto,
    RejectCreditTopupRequestDto,
    UpdateCreditPackageDto,
} from './credit-topup.dto';

/**
 * The shop's half: balances, packages, and the bKash receipt it submits.
 *
 * Kept at `/sms-credits` and under its old class name so existing clients and
 * the route-authorization baseline keep working; it now covers WhatsApp and
 * email too. There is no route here that adds credits.
 */
@Controller('sms-credits')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SmsCreditController {
    constructor(private readonly topups: CreditTopupService) {}

    @Get('summary')
    getSummary(@Tenant() tenant: TenantContext) {
        return this.topups.getSummary(tenant);
    }

    /**
     * Tight on purpose: every submission opens a support ticket a person has
     * to read, so the useful rate is a handful an hour.
     */
    @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
    @UseGuards(StorePermissionGuard)
    @RequireStorePermission(StorePermission.MANAGE_USERS)
    @Post('topup-requests')
    submitTopupRequest(@Tenant() tenant: TenantContext, @Body() dto: CreateCreditTopupRequestDto) {
        return this.topups.submitRequest(tenant, dto);
    }
}

/**
 * The platform team's queue of bKash payments to verify. Full platform admins
 * only — approving adds credits and records money, which a support engineer's
 * seat does not cover (they still see each request as a support ticket).
 */
@Controller('admin/credit-topups')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminCreditTopupsController {
    constructor(private readonly topups: CreditTopupService) {}

    @Get()
    list(@Query() query: ListCreditTopupRequestsDto) {
        return this.topups.listRequests(query.status);
    }

    @Post(':id/approve')
    approve(@Param('id') id: string, @Body() dto: ApproveCreditTopupRequestDto, @Request() req: any) {
        return this.topups.approve(id, req.user.userId, dto);
    }

    @Post(':id/reject')
    reject(@Param('id') id: string, @Body() dto: RejectCreditTopupRequestDto, @Request() req: any) {
        return this.topups.reject(id, req.user.userId, dto);
    }

    @Get('packages')
    listPackages() {
        return this.topups.listPackages();
    }

    @Post('packages')
    createPackage(@Body() dto: CreateCreditPackageDto) {
        return this.topups.createPackage(dto);
    }

    @Patch('packages/:id')
    updatePackage(@Param('id') id: string, @Body() dto: UpdateCreditPackageDto) {
        return this.topups.updatePackage(id, dto);
    }
}
