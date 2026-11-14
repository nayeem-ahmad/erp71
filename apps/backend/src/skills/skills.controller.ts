import {
    Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
    UseGuards, UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission, RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { HR_WRITE, SKILL_READ } from '../auth/permission-sets';
import { SkillsService } from './skills.service';
import { AssignPersonSkillDto, CreateSkillDto, UpdatePersonSkillDto, UpdateSkillDto } from './skill.dto';

@Controller('skills')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SkillsController {
    constructor(private readonly skills: SkillsService) {}

    @Get()
    @RequireAnyStorePermission(...SKILL_READ)
    list(@Tenant() tenant: TenantContext, @Query('status') status?: string) {
        return this.skills.list(tenant.tenantId, { status });
    }

    @Post()
    @RequireStorePermission(...HR_WRITE)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateSkillDto) {
        return this.skills.create(tenant.tenantId, dto);
    }

    @Post('people')
    @RequireStorePermission(...HR_WRITE)
    assignPerson(@Tenant() tenant: TenantContext, @Body() dto: AssignPersonSkillDto) {
        return this.skills.assignPerson(tenant.tenantId, dto);
    }

    @Patch('people/:id')
    @RequireStorePermission(...HR_WRITE)
    updatePerson(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdatePersonSkillDto,
    ) {
        return this.skills.updatePerson(tenant.tenantId, id, dto);
    }

    @Delete('people/:id')
    @RequireStorePermission(...HR_WRITE)
    @HttpCode(HttpStatus.NO_CONTENT)
    removePerson(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.skills.removePerson(tenant.tenantId, id);
    }

    @Patch(':id')
    @RequireStorePermission(...HR_WRITE)
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSkillDto) {
        return this.skills.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(...HR_WRITE)
    @HttpCode(HttpStatus.NO_CONTENT)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.skills.remove(tenant.tenantId, id);
    }
}
