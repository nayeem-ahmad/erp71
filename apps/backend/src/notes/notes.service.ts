import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AssetsService } from '../assets/assets.service';
import { parseImageUpload } from '../common/image-upload.util';
import { DatabaseService } from '../database/database.service';
import { CreateNoteDto, ListNotesQueryDto, UpdateNoteDto, UploadNoteImageDto } from './notes.dto';

/**
 * Folder handed to `uploadBuffer`, which prefixes `retail/` itself. Shared
 * with the direct-upload signature (`UPLOAD_PURPOSES['note-image']`) so a
 * picture uploaded either way lands in the same place.
 */
export function noteImageFolder(tenantId: string): string {
    return `${tenantId}/notes`;
}

/** Who is asking: notes are scoped to the member *and* the workspace. */
export interface NoteOwner {
    tenantId: string;
    userId: string;
}

/** What the list sends: enough for the sidebar of notes, without every body. */
const LIST_SELECT = {
    id: true,
    title: true,
    pinned: true,
    created_at: true,
    updated_at: true,
    content: true,
} as const;

/** Characters of body text the list returns as a preview. */
const PREVIEW_LENGTH = 160;

/**
 * A plain-text glimpse of a markdown body for the list: pictures and link
 * targets dropped, syntax characters stripped, whitespace folded.
 */
export function notePreview(markdown: string): string {
    return markdown
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`*_~#>]+/g, '')
        .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, PREVIEW_LENGTH);
}

@Injectable()
export class NotesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly assets: AssetsService,
    ) {}

    /** The member's notes, pinned first, most recently edited next. */
    async findAll(owner: NoteOwner, query: ListNotesQueryDto = {}) {
        const search = query.search?.trim();
        const rows = await this.db.note.findMany({
            where: {
                tenant_id: owner.tenantId,
                user_id: owner.userId,
                ...(search
                    ? {
                          OR: [
                              { title: { contains: search, mode: 'insensitive' as const } },
                              { content: { contains: search, mode: 'insensitive' as const } },
                          ],
                      }
                    : {}),
            },
            orderBy: [{ pinned: 'desc' }, { updated_at: 'desc' }],
            select: LIST_SELECT,
            take: 500,
        });
        return rows.map(({ content, ...row }) => ({
            ...row,
            preview: notePreview(content),
            hasImages: /!\[[^\]]*\]\([^)]+\)/.test(content),
        }));
    }

    async findOne(owner: NoteOwner, id: string) {
        const note = await this.db.note.findFirst({
            where: { id, tenant_id: owner.tenantId, user_id: owner.userId },
        });
        // Someone else's note is reported exactly like a missing one, so the
        // route cannot be used to learn which ids exist.
        if (!note) throw new NotFoundException('Note not found.');
        return note;
    }

    create(owner: NoteOwner, dto: CreateNoteDto) {
        return this.db.note.create({
            data: {
                tenant_id: owner.tenantId,
                user_id: owner.userId,
                title: dto.title ?? '',
                content: dto.content ?? '',
                pinned: dto.pinned ?? false,
            },
        });
    }

    async update(owner: NoteOwner, id: string, dto: UpdateNoteDto) {
        await this.findOne(owner, id);
        return this.db.note.update({
            where: { id },
            data: {
                ...(dto.title !== undefined ? { title: dto.title } : {}),
                ...(dto.content !== undefined ? { content: dto.content } : {}),
                ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
            },
        });
    }

    async remove(owner: NoteOwner, id: string) {
        await this.findOne(owner, id);
        await this.db.note.delete({ where: { id } });
        return { id };
    }

    /**
     * Keep a picture for a note when the browser could not post it straight
     * to Cloudinary. The note itself only ever holds the returned URL.
     */
    async uploadImage(owner: NoteOwner, dto: UploadNoteImageDto): Promise<{ url: string; storageKey: string }> {
        const { buffer } = parseImageUpload(dto.imageBase64, dto.mimeType);

        if (!this.assets.isEnabled()) {
            throw new ServiceUnavailableException(
                'File storage is not configured, so the picture could not be saved.',
            );
        }

        const stem = (dto.fileName ?? 'image').replace(/\.[^.]+$/, '').slice(0, 100);
        const safeStem = stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';

        let stored: { url: string; publicId: string };
        try {
            stored = await this.assets.uploadBuffer(buffer, noteImageFolder(owner.tenantId), safeStem, 'image');
        } catch {
            throw new ServiceUnavailableException('The picture could not be uploaded. Try again.');
        }
        return { url: stored.url, storageKey: stored.publicId };
    }
}
