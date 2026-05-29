import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminTenantsService } from './admin-tenants.service';
import { ListAdminUsersQueryDto } from './admin-tenants.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminUsersController {
    constructor(private readonly adminTenantsService: AdminTenantsService) {}

    @Get()
    listUsers(@Query() query: ListAdminUsersQueryDto) {
        return this.adminTenantsService.listUsers(query);
    }

    @Post(':userId/promote')
    promoteUser(@Param('userId') userId: string) {
        return this.adminTenantsService.promoteUser(userId);
    }

    @Delete(':userId/promote')
    demoteUser(@Param('userId') userId: string) {
        return this.adminTenantsService.demoteUser(userId);
    }
}
