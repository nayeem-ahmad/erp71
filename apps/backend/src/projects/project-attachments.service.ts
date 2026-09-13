import {
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { AssetsService } from '../assets/assets.service';
import { CreateAttachmentDto } from './project.dto';
import { parseAttachmentUpload, resourceTypeFor } from '../common/file-upload.util';

// Moved to common/file-upload.util.ts when import documents needed the same
// three helpers. Re-exported so existing importers and tests are untouched.
export {
    ATTACHMENT_MIME_TYPES,
    MAX_ATTACHMENT_BASE64_LENGTH,
    parseAttachmentUpload,
    resourceTypeFor,
} from '../common/file-upload.util';

const ATTACHMENT_INCLUDE = {
    creator: { select: { id: true, name: true, email: true } },
} as const;

/**
 * `ProjectAttachment` has had a model since Phase 1 and no API at all. This is
 * that API — built on `uploadBuffer` and a `storage_key` rather than the older
 * `uploadFile`, which returns only a URL that cannot be turned back into a
 * Cloudinary `public_id`. Without the key, deleting a row strands the file and
 * it is billed forever; that is the leak logged in TODO.md.
 */
@Injectable()
export class ProjectAttachmentsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly assets: AssetsService,
        private readonly access: ProjectAccessService,
    ) {}

    async list(viewer: ProjectViewer, taskId: string) {
        const tenantId = viewer.tenantId;
        await this.assertTask(viewer, taskId);
        return this.db.projectAttachment.findMany({
            where: { tenant_id: tenantId, task_id: taskId },
            orderBy: { created_at: 'desc' },
            include: ATTACHMENT_INCLUDE,
        });
    }

    async create(viewer: ProjectViewer, taskId: string, dto: CreateAttachmentDto) {
        const tenantId = viewer.tenantId;
        const userId = viewer.userId;
        const task = await this.assertTask(viewer, taskId);
        const { buffer, mimeType } = parseAttachmentUpload(dto.fileBase64, dto.mimeType);

        if (!this.assets.isEnabled()) {
            // Distinguishable from a transient failure: this will not fix itself
            // on retry, and the operator needs to know why.
            throw new ServiceUnavailableException(
                'File storage is not configured, so the attachment could not be kept.',
            );
        }

        const stem = (dto.fileName ?? 'attachment').replace(/\.[^.]+$/, '').slice(0, 100);
        const safeStem =
            stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
        const extension = mimeType === 'application/pdf' ? 'pdf' : (mimeType.split('/')[1] ?? 'jpg');

        let stored: { url: string; publicId: string; bytes: number };
        try {
            stored = await this.assets.uploadBuffer(
                buffer,
                `${tenantId}/project-tasks`,
                safeStem,
                resourceTypeFor(mimeType),
            );
        } catch {
            throw new ServiceUnavailableException('The attachment could not be uploaded.');
        }

        return this.db.projectAttachment.create({
            data: {
                tenant_id: tenantId,
                task_id: taskId,
                project_id: task.project_id,
                file_url: stored.url,
                file_name: `${safeStem}.${extension}`,
                mime_type: mimeType,
                file_size: stored.bytes ?? buffer.byteLength,
                storage_key: stored.publicId,
                created_by: userId,
            },
            include: ATTACHMENT_INCLUDE,
        });
    }

    async remove(viewer: ProjectViewer, attachmentId: string) {
        // Addressed by its own id with no task in the route, so the project it
        // belongs to has to be resolved through the task before deleting it.
        const filter = await this.access.taskFilter(viewer);
        const existing = await this.db.projectAttachment.findFirst({
            where: {
                id: attachmentId,
                tenant_id: viewer.tenantId,
                ...(Object.keys(filter).length ? { task: filter } : {}),
            } as never,
            select: { id: true, storage_key: true, mime_type: true },
        });
        if (!existing) throw new NotFoundException('Attachment not found');

        await this.db.projectAttachment.delete({ where: { id: existing.id } });

        // After the row, not before: a failed delete here leaves a stray file,
        // while the reverse leaves a row pointing at nothing — a broken link in
        // the UI is worse than a few bytes of orphaned storage.
        if (existing.storage_key) {
            await this.assets.deleteFile(
                existing.storage_key,
                resourceTypeFor(existing.mime_type ?? ''),
            );
        }
        return { success: true };
    }

    private async assertTask(viewer: ProjectViewer, taskId: string) {
        const task = await this.db.projectTask.findFirst({
            where: {
                id: taskId,
                tenant_id: viewer.tenantId,
                deleted_at: null,
                ...(await this.access.taskFilter(viewer)),
            } as never,
            select: { id: true, project_id: true },
        });
        if (!task) throw new NotFoundException('Task not found');
        return task;
    }
}
