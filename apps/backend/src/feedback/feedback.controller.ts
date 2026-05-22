import {
    Controller,
    Post,
    Body,
    UseGuards,
    UseInterceptors,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import { IsEnum, IsString, IsOptional, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

enum FeedbackType {
    bug = 'bug',
    feature = 'feature',
    general = 'general',
}

class CreateFeedbackDto {
    @IsEnum(FeedbackType)
    type: FeedbackType;

    @IsString()
    @MinLength(3)
    message: string;

    @IsString()
    @IsOptional()
    page?: string;
}

@Controller('feedback')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class FeedbackController {
    private readonly logger = new Logger(FeedbackController.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly emailService: EmailService,
    ) {}

    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateFeedbackDto) {
        if (!['bug', 'feature', 'general'].includes(dto.type)) {
            throw new BadRequestException('type must be one of: bug, feature, general');
        }

        const feedback = await this.db.feedback.create({
            data: {
                tenantId: tenant.tenantId,
                userId: tenant.userId,
                type: dto.type,
                message: dto.message,
                page: dto.page ?? null,
            },
        });

        const feedbackEmail = process.env.FEEDBACK_EMAIL;
        if (feedbackEmail) {
            this.emailService
                .sendFeedbackNotification(feedbackEmail, feedback.id, dto.type, dto.message, dto.page ?? undefined)
                .catch((err) => this.logger.error(`Failed to send feedback email: ${err}`));
        }

        return { id: feedback.id };
    }
}
