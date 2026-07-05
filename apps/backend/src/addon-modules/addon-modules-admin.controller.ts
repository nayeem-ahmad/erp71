import { Body, Controller, Get, Param, Post, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AddonModulesService } from './addon-modules.service';
import { CreateAddonModuleDto, UpdateAddonModuleDto } from './addon-modules.dto';

@Controller('admin/addon-modules')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AddonModulesAdminController {
    constructor(private readonly addonModules: AddonModulesService) {}

    @Get()
    list() {
        return this.addonModules.listAllForAdmin();
    }

    @Get(':id')
    get(@Param('id') id: string) {
        return this.addonModules.getByIdForAdmin(id);
    }

    @Post()
    create(
        @Body() dto: CreateAddonModuleDto,
        @Request() req: { user: { userId: string } },
    ) {
        return this.addonModules.createAddon(dto, req.user.userId);
    }

    @Put(':id')
    update(
        @Param('id') id: string,
        @Body() dto: UpdateAddonModuleDto,
        @Request() req: { user: { userId: string } },
    ) {
        return this.addonModules.updateAddon(id, dto, req.user.userId);
    }
}
