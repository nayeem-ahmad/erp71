import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import {
    deriveKnockSubject,
    inboxEnabled,
    isCategoryEnabled,
    isFeedbackCategory,
    isKnockCategory,
    type KnockCategory,
} from './support.util';

export interface CreateKnockInput {
    tenantId: string;
    userId: string;
    category: string;
    subject?: string;
    body: string;
    page?: string | null;
}

@Injectable()
export class SupportService {
    private readonly logger = new Logger(SupportService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly emailService: EmailService,
    ) {}

    async assertInboxEnabled(tenantId: string) {
        const features = await this.platformSettings.getFeaturesForTenant(tenantId);
        if (!inboxEnabled(features)) {
            throw new ServiceUnavailableException('Support is not available');
        }
        return features;
    }

    async createKnock(input: CreateKnockInput): Promise<{ id: string; feedbackId: string | null }> {
        if (!isKnockCategory(input.category)) {
            throw new BadRequestException('category must be one of: support, bug, feature, general');
        }
        const category: KnockCategory = input.category;
        const features = await this.assertInboxEnabled(input.tenantId);
        if (!isCategoryEnabled(features, category)) {
            throw new ForbiddenException(
                category === 'support' ? 'Support chat is not available' : 'Feedback is not available',
            );
        }

        const body = input.body.trim();
        if (body.length < 3) {
            throw new BadRequestException('Message is too short');
        }

        const page = isFeedbackCategory(category) ? (input.page?.trim() || null) : null;
        const subject = (input.subject?.trim() || deriveKnockSubject(category, body, page)).slice(0, 200);

        const result = await this.db.$transaction(async (tx) => {
            let feedbackId: string | null = null;
            if (isFeedbackCategory(category)) {
                const feedback = await tx.feedback.create({
                    data: {
                        tenantId: input.tenantId,
                        userId: input.userId,
                        type: category,
                        message: body,
                        page,
                    },
                });
                feedbackId = feedback.id;
            }

            const thread = await tx.supportThread.create({
                data: {
                    tenantId: input.tenantId,
                    subject,
                    category,
                    page,
                    feedbackId,
                    messages: {
                        create: {
                            senderId: input.userId,
                            senderRole: 'owner',
                            body,
                        },
                    },
                },
            });

            return { id: thread.id, feedbackId };
        });

        if (result.feedbackId) {
            this.notifyFeedback(result.feedbackId, category, body, page);
        }

        return result;
    }

    async backfillFeedbackThreads(): Promise<number> {
        const orphans = await this.db.feedback.findMany({
            where: { thread: null },
            select: {
                id: true,
                tenantId: true,
                userId: true,
                type: true,
                message: true,
                page: true,
                createdAt: true,
            },
        });

        let created = 0;
        for (const fb of orphans) {
            const category = isFeedbackCategory(fb.type) ? fb.type : 'general';
            await this.db.supportThread.create({
                data: {
                    tenantId: fb.tenantId,
                    subject: deriveKnockSubject(category, fb.message, fb.page),
                    category,
                    page: fb.page,
                    feedbackId: fb.id,
                    createdAt: fb.createdAt,
                    updatedAt: fb.createdAt,
                    messages: {
                        create: {
                            senderId: fb.userId,
                            senderRole: 'owner',
                            body: fb.message,
                            createdAt: fb.createdAt,
                        },
                    },
                },
            });
            created += 1;
        }
        return created;
    }

    private notifyFeedback(
        feedbackId: string,
        category: KnockCategory,
        body: string,
        page: string | null,
    ) {
        const feedbackEmail = process.env.FEEDBACK_EMAIL;
        if (!feedbackEmail) return;
        this.emailService
            .sendFeedbackNotification(feedbackEmail, feedbackId, category, body, page ?? undefined)
            .catch((err) => this.logger.error(`Failed to send feedback email: ${err}`));
    }
}
