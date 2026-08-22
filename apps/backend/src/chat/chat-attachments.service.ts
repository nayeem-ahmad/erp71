import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AssetsService } from '../assets/assets.service';
import { DatabaseService } from '../database/database.service';
import { ChatAttachmentUploadDto } from './chat.dto';
import {
    extensionFor,
    parseChatAttachmentUpload,
    resourceTypeFor,
    safeAttachmentStem,
} from './chat.util';

export interface PreparedAttachment {
    file_url: string;
    file_name: string;
    mime_type: string;
    file_size: number;
    storage_key: string;
}

/**
 * Uploads run *before* the message row is written, so a storage failure fails
 * the send outright instead of leaving a message whose attachments silently
 * vanished. The cost is that a partial batch can strand files in Cloudinary;
 * `rollback` cleans those up on the failure path.
 */
@Injectable()
export class ChatAttachmentsService {
    private readonly logger = new Logger(ChatAttachmentsService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly assets: AssetsService,
    ) {}

    async prepare(
        tenantId: string,
        uploads: ChatAttachmentUploadDto[],
    ): Promise<PreparedAttachment[]> {
        if (uploads.length === 0) return [];

        if (!this.assets.isEnabled()) {
            // Distinguishable from a transient failure: this will not fix itself
            // on retry, and the operator needs to know why.
            throw new ServiceUnavailableException(
                'File storage is not configured, so attachments cannot be sent.',
            );
        }

        const stored: PreparedAttachment[] = [];
        try {
            for (const upload of uploads) {
                const { buffer, mimeType } = parseChatAttachmentUpload(
                    upload.fileBase64,
                    upload.mimeType,
                );
                const stem = safeAttachmentStem(upload.fileName);
                const result = await this.assets.uploadBuffer(
                    buffer,
                    `${tenantId}/chat`,
                    stem,
                    resourceTypeFor(mimeType),
                );
                stored.push({
                    file_url: result.url,
                    file_name: `${stem}.${extensionFor(mimeType)}`,
                    mime_type: mimeType,
                    file_size: result.bytes ?? buffer.byteLength,
                    storage_key: result.publicId,
                });
            }
        } catch (error) {
            // Anything already uploaded in this batch is now unreferenced.
            await this.rollback(stored);
            throw error;
        }

        return stored;
    }

    /** Best-effort cleanup of files whose message never got written. */
    async rollback(prepared: PreparedAttachment[]): Promise<void> {
        for (const attachment of prepared) {
            await this.assets
                .deleteFile(attachment.storage_key, resourceTypeFor(attachment.mime_type))
                .catch((error) =>
                    this.logger.error(`Failed to roll back ${attachment.storage_key}: ${error}`),
                );
        }
    }

    /**
     * Removes the stored files behind a message, then the rows. Called when a
     * message is deleted: a soft-deleted message keeps its place in the thread,
     * but there is no reason to keep paying to host a file nobody can reach.
     */
    async purgeForMessage(messageId: string): Promise<void> {
        const attachments = await this.db.chatAttachment.findMany({
            where: { message_id: messageId },
            select: { id: true, storage_key: true, mime_type: true },
        });

        for (const attachment of attachments) {
            if (!attachment.storage_key) continue;
            await this.assets
                .deleteFile(attachment.storage_key, resourceTypeFor(attachment.mime_type))
                .catch((error) =>
                    this.logger.error(`Failed to delete ${attachment.storage_key}: ${error}`),
                );
        }

        await this.db.chatAttachment.deleteMany({ where: { message_id: messageId } });
    }
}
