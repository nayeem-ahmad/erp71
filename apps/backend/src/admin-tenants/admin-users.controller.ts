import { Controller, Delete, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminTenantsService } from './admin-tenants.service';
import { ListAdminUsersQueryDto } from './admin-tenants.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminUsersController {
    constructor(private readonly adminTenantsService: AdminTenantsService) {}

    @Get('lookup')
    lookupUser(@Query('email') email: string) {
        return this.adminTenantsService.lookupUserByEmail(email);
    }

    @Get()
    listUsers(@Query() query: ListAdminUsersQueryDto) {
        return this.adminTenantsService.listUsers(query);
    }

    @Post(':userId/promote')
    promoteUser(@Param('userId') userId: string, @Request() req: any) {
        return this.adminTenantsService.promoteUser(userId, req.user.userId);
    }

    @Delete(':userId/promote')
    demoteUser(@Param('userId') userId: string, @Request() req: any) {
        return this.adminTenantsService.demoteUser(userId, req.user.userId);
    }
}
