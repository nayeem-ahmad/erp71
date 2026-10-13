import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AssetsService } from '../assets/assets.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import {
    deriveKnockSubject,
    inboxEnabled,
    isCategoryEnabled,
    isFeedbackCategory,
    isKnockCategory,
    type KnockCategory,
} from './support.util';
import {
    prepareSupportAttachments,
    type PreparedSupportAttachment,
    type SupportUploadFile,
} from './support-attachment.util';

export interface CreateKnockInput {
    tenantId: string;
    userId: string;
    category: string;
    subject?: string;
    /** May be empty when attachments carry the report. */
    body?: string;
    page?: string | null;
    /** Screenshots, documents and voice notes sent with the first message. */
    attachments?: SupportUploadFile[];
}

interface StoredSupportAttachment {
    kind: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    storageKey: string;
    resourceType: string;
}

@Injectable()
export class SupportService {
    private readonly logger = new Logger(SupportService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly emailService: EmailService,
        private readonly assets: AssetsService,
    ) {}

    async assertInboxEnabled(tenantId: string) {
        const features = await this.platformSettings.getFeaturesForTenant(tenantId);
        if (!inboxEnabled(features)) {
            throw new ServiceUnavailableException('Support is not available');
        }
        return features;
    }

    async createKnock(
        input: CreateKnockInput,
    ): Promise<{ id: string; ticketNumber: number; feedbackId: string | null }> {
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

        const prepared = prepareSupportAttachments(input.attachments);
        // A voice note or a screenshot can be the whole report — someone who
        // would rather talk than type should not have to invent three letters.
        const body = (input.body ?? '').trim() || (prepared.length ? describeAttachments(prepared) : '');
        if (body.length < 3 && !prepared.length) {
            throw new BadRequestException('Message is too short');
        }

        const page = isFeedbackCategory(category) ? (input.page?.trim() || null) : null;
        const subject = (input.subject?.trim() || deriveKnockSubject(category, body, page)).slice(0, 200);

        const stored = await this.storeAttachments(input.tenantId, prepared);

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
                    createdById: input.userId,
                    messages: {
                        create: {
                            senderId: input.userId,
                            senderRole: 'owner',
                            body,
                            ...(stored.length
                                ? {
                                      attachments: {
                                          create: stored.map((a) => ({ ...a, tenantId: input.tenantId })),
                                      },
                                  }
                                : {}),
                        },
                    },
                },
            });

            return { id: thread.id, ticketNumber: thread.ticketNumber, feedbackId };
        }).catch(async (err) => {
            // The files went up before the rows that point at them; without
            // this a failed insert would leave them in Cloudinary for good.
            await this.discardAttachments(stored);
            throw err;
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
                    createdById: fb.userId,
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

    /**
     * Upload every file before the thread exists, so the transaction above
     * never holds a connection open across a network call. One failure undoes
     * the ones already stored — a ticket arrives with all its files or none.
     */
    private async storeAttachments(
        tenantId: string,
        prepared: PreparedSupportAttachment[],
    ): Promise<StoredSupportAttachment[]> {
        if (!prepared.length) return [];
        if (!this.assets.isEnabled()) {
            throw new ServiceUnavailableException('Attachments are not available right now. Send the message without them.');
        }

        const stored: StoredSupportAttachment[] = [];
        try {
            for (const file of prepared) {
                const uploaded = await this.assets.uploadBuffer(
                    file.buffer,
                    `support/${tenantId}`,
                    supportStorageName(file),
                    file.resourceType,
                );
                stored.push({
                    kind: file.kind,
                    fileUrl: uploaded.url,
                    fileName: file.fileName,
                    mimeType: file.mimeType,
                    fileSize: uploaded.bytes ?? file.size,
                    storageKey: uploaded.publicId,
                    resourceType: file.resourceType,
                });
            }
        } catch (err) {
            this.logger.error(`Support attachment upload failed: ${err}`);
            await this.discardAttachments(stored);
            throw new ServiceUnavailableException('Could not upload the attachments. Please try again.');
        }
        return stored;
    }

    private async discardAttachments(stored: StoredSupportAttachment[]) {
        await Promise.all(
            stored.map((a) =>
                this.assets
                    .deleteFile(a.storageKey, a.resourceType as 'image' | 'raw' | 'video')
                    .catch(() => undefined),
            ),
        );
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

/** The message body for a ticket sent with attachments and no words. */
export function describeAttachments(prepared: Pick<PreparedSupportAttachment, 'kind'>[]): string {
    const voice = prepared.filter((a) => a.kind === 'voice').length;
    const files = prepared.length - voice;
    const parts: string[] = [];
    if (voice) parts.push(voice === 1 ? 'Voice note' : `${voice} voice notes`);
    if (files) parts.push(files === 1 ? '1 attachment' : `${files} attachments`);
    return `(${parts.join(' + ')})`;
}

/**
 * The Cloudinary `public_id` for an upload. Named, so the folder is readable,
 * but suffixed: with `overwrite: false` a second "image.png" pasted into the
 * same tenant's folder would otherwise come back as the first one. A raw file
 * keeps its extension — Cloudinary serves raw assets by the name they have,
 * and a PDF without `.pdf` downloads instead of opening.
 */
export function supportStorageName(file: Pick<PreparedSupportAttachment, 'fileName' | 'kind' | 'resourceType'>): string {
    const ext = /\.([a-z0-9]{1,8})$/i.exec(file.fileName)?.[1]?.toLowerCase();
    const stem = file.fileName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 60) || file.kind;
    const name = `${stem}-${randomBytes(4).toString('hex')}`;
    return file.resourceType === 'raw' && ext ? `${name}.${ext}` : name;
}
