import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Request,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminTenantsService } from './admin-tenants.service';
import {
    AdminResetPlatformUserPasswordDto,
    CreatePlatformAdminUserDto,
    ListAdminUsersQueryDto,
    UpdatePlatformAdminUserDto,
} from './admin-tenants.dto';

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

    @Post()
    createUser(@Body() dto: CreatePlatformAdminUserDto, @Request() req: any) {
        return this.adminTenantsService.createPlatformAdminUser(dto, req.user.userId);
    }

    @Patch(':userId')
    updateUser(
        @Param('userId') userId: string,
        @Body() dto: UpdatePlatformAdminUserDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.updatePlatformAdminUser(userId, dto, req.user.userId);
    }

    @Delete(':userId')
    deleteUser(@Param('userId') userId: string, @Request() req: any) {
        return this.adminTenantsService.deletePlatformAdminUser(userId, req.user.userId);
    }

    @Post(':userId/reset-password')
    resetPassword(
        @Param('userId') userId: string,
        @Body() dto: AdminResetPlatformUserPasswordDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.resetPlatformAdminUserPassword(userId, dto, req.user.userId);
    }

    @Post(':userId/send-reset-email')
    sendResetEmail(@Param('userId') userId: string, @Request() req: any) {
        return this.adminTenantsService.sendPlatformAdminUserResetEmail(userId, req.user.userId);
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