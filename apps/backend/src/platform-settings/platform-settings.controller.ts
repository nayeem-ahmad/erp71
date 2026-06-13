import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Request,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { SmsService } from '../sms/sms.service';
import { EmailService } from '../email/email.service';
import { AiService } from '../ai/ai.service';
import { PlatformSettingsService, VALID_GROUPS } from './platform-settings.service';
import { UpsertGroupSettingsDto, TestSmsDto, TestEmailDto } from './platform-settings.dto';

@Controller('admin/platform-settings')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformSettingsController {
    constructor(
        private readonly platformSettings: PlatformSettingsService,
        private readonly smsService: SmsService,
        private readonly emailService: EmailService,
        private readonly aiService: AiService,
    ) {}

    @Get(':group')
    async getGroup(@Param('group') group: string) {
        this.validateGroup(group);
        return this.platformSettings.getGroup(group);
    }

    @Patch(':group')
    async upsertGroup(
        @Param('group') group: string,
        @Body() dto: UpsertGroupSettingsDto,
        @Request() req: any,
    ) {
        this.validateGroup(group);
        await this.platformSettings.upsertSettings(group, dto.settings, req.user.userId);
        return this.platformSettings.getGroup(group);
    }

    @Post('sms/test')
    async testSms(@Body() dto: TestSmsDto) {
        await this.smsService.sendSms(dto.phone, 'Test message from RetailSaaS. Your SMS gateway is configured correctly.');
        return { message: 'Test SMS dispatched' };
    }

    @Post('email/test')
    async testEmail(@Body() dto: TestEmailDto, @Request() req: any) {
        const to = dto.email || req.user.email;
        await this.emailService.sendWelcome(to, 'Platform Admin');
        return { message: `Test email dispatched to ${to}` };
    }

    @Post('ai/test')
    async testAi() {
        return this.aiService.testConnection();
    }

    private validateGroup(group: string) {
        if (!VALID_GROUPS.includes(group)) {
            throw new BadRequestException(
                `Invalid settings group "${group}". Valid groups: ${VALID_GROUPS.join(', ')}`,
            );
        }
    }
}
