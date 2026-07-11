import { Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { DeployService } from './deploy.service';

@Controller('admin/deploy')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class DeployController {
    constructor(private readonly service: DeployService) {}

    @Get('status')
    async status() {
        return this.service.getStatus();
    }

    @Post()
    async deploy(@Request() req: any) {
        return this.service.triggerDeploy(req.user.userId);
    }
}
