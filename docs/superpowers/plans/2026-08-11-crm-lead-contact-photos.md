# CRM Lead & Contact Profile Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `Lead` and `CrmContact` an optional profile photo, set from their create/edit forms and rendered inline in the first column of both list pages.

**Architecture:** Two nullable columns (`photo_url`, `photo_storage_key`) on each model. A new `POST /crm/photos` endpoint uploads a cropped image to Cloudinary via the existing `AssetsService.uploadBuffer()` and returns both the CDN URL and the `public_id`, so a replaced or deleted photo can actually be reclaimed. The form uploads on crop-confirm and carries both values into the ordinary create/update payload, keeping the save one-phase. Both CRM services validate the incoming storage key is inside the tenant's own folder before ever handing it to `cloudinary.destroy`.

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend), Next.js 15 + React + TanStack Table + Tailwind (frontend), Cloudinary (storage), Jest + React Testing Library (tests).

**Spec:** `docs/superpowers/specs/2026-08-11-crm-lead-contact-photos-design.md`

## Global Constraints

- **Branch:** all work happens on `dev`. `.githooks/` blocks commits on `main`.
- **Migrations:** `prisma migrate dev` fails against the local dev DB (it has no `_prisma_migrations` table). Write the migration directory by hand, apply the SQL directly to the local DB, then run `prisma generate`. The local Postgres container `erp71-db-1` listens on **port 5434**, not the 5432 in `.env`.
- **Migration naming:** check the newest existing directory under `packages/database/prisma/migrations/` and pick a strictly later timestamp prefix. A colliding timestamp has broken this repo before.
- **Multi-tenancy:** every business query is scoped by `tenant_id`. Never trust a client-supplied identifier that names a stored object.
- **UI rules** (from `CLAUDE.md`, full spec `docs/ui-design-guidelines.md`):
  - One accent color: `blue-600` for primary actions/links. No violet/indigo/emerald/rose accents.
  - Semantic colors: emerald = success, amber = warning, red = danger.
  - No arbitrary hex Tailwind classes (`bg-[#f3f4f6]`). No `rounded-2xl` / `rounded-3xl`. No `font-black uppercase tracking-widest`.
  - Compact density: `text-sm` / `text-xs` body.
  - Notifications go through the global toast store only (`import { toast } from '@/lib/toast'`). No `alert()`.
  - Mobile: ≥44px touch targets via `min-h-touch`.
- **i18n:** no user-visible string is hardcoded. Every new key is added to **all three** locales: `en`, `bn`, `ms` under `apps/frontend/src/lib/localization/messages/<locale>/`.
- **Commits:** end every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **TODO.md:** after the final task, tick the "Profile photos on Leads and Contacts" item under `### CRM Module (Epic 70–74)` and move it to `## COMPLETED` with today's date.

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `apps/backend/src/common/image-upload.util.ts` | `parseImageUpload()` + MIME/size constants, moved out of the contacts service so more than one module can use them |
| `apps/backend/src/common/image-upload.util.spec.ts` | Tests for the above |
| `apps/backend/src/crm-photos/crm-photos.dto.ts` | `UploadCrmPhotoDto` |
| `apps/backend/src/crm-photos/crm-photos.service.ts` | Upload to Cloudinary; `assertTenantPhotoKey()` guard shared with both CRM services |
| `apps/backend/src/crm-photos/crm-photos.controller.ts` | `POST /crm/photos` |
| `apps/backend/src/crm-photos/crm-photos.module.ts` | Wiring |
| `apps/backend/src/crm-photos/crm-photos.service.spec.ts` | Tests |
| `packages/database/prisma/migrations/<ts>_add_crm_photos/migration.sql` | The four columns |
| `apps/frontend/src/components/Avatar.tsx` | Presentational avatar — image or initials |
| `apps/frontend/src/components/Avatar.test.tsx` | Tests |
| `apps/frontend/src/components/PhotoField.tsx` | Form control — pick, crop, upload, remove |
| `apps/frontend/src/components/PhotoField.test.tsx` | Tests |

**Modify:**

| File | Change |
| --- | --- |
| `packages/database/prisma/schema.prisma` | `photo_url` + `photo_storage_key` on `Lead` and `CrmContact` |
| `apps/backend/src/crm-contacts/crm-contacts.service.ts` | Import `parseImageUpload` from common; photo create/update/delete handling |
| `apps/backend/src/crm-contacts/crm-contacts.dto.ts` | Photo fields on Create/Update DTOs |
| `apps/backend/src/crm-contacts/crm-contacts.module.ts` | Import `CrmPhotosModule` |
| `apps/backend/src/crm-leads/crm-leads.service.ts` | Inject `AssetsService` + `CrmPhotosService`; photo create/update/delete handling |
| `apps/backend/src/crm-leads/crm-leads.dto.ts` | Photo fields on Create/Update DTOs |
| `apps/backend/src/crm-leads/crm-leads.module.ts` | Import `AssetsModule` + `CrmPhotosModule` |
| `apps/backend/src/app.module.ts` | Register `CrmPhotosModule` |
| `apps/frontend/src/lib/api.ts` | `uploadCrmPhoto()` |
| `apps/frontend/src/app/(app)/crm/contacts/contact-form-fields.tsx` | Photo in form state + `PhotoField` in the grid |
| `apps/frontend/src/app/(app)/crm/leads/lead-form-fields.tsx` | Same for leads |
| `apps/frontend/src/app/(app)/crm/contacts/page.tsx` | Avatar in the name cell |
| `apps/frontend/src/app/(app)/crm/leads/page.tsx` | Avatar in the name cell |
| `apps/frontend/src/lib/localization/messages/{en,bn,ms}/crmHr.ts` | New keys |
| `TODO.md` | Tick the item |

---

## Task 1: Schema columns and migration

**Files:**

- Modify: `packages/database/prisma/schema.prisma` (`Lead` ~line 1966, `CrmContact` ~line 2101)
- Create: `packages/database/prisma/migrations/<timestamp>_add_crm_photos/migration.sql`

**Interfaces:**

- Consumes: nothing.
- Produces: Prisma client fields `photo_url: string | null` and `photo_storage_key: string | null` on both the `Lead` and `CrmContact` models, available as `db.lead.*` and `db.crmContact.*` in every later task.

- [ ] **Step 1: Add the columns to `Lead`**

In `packages/database/prisma/schema.prisma`, inside `model Lead`, add these two lines immediately after `website_url          String?`:

```prisma
  photo_url             String?
  /// Cloudinary's public_id for `photo_url`. A secure_url cannot be turned back
  /// into one, so without this a replaced photo is stranded and billed forever —
  /// the trap VoucherAttachment and ProjectAttachment are still in.
  photo_storage_key     String?
```

- [ ] **Step 2: Add the columns to `CrmContact`**

In the same file, inside `model CrmContact`, add immediately after `linkedin_url   String?`:

```prisma
  photo_url      String?
  /// Cloudinary's public_id for `photo_url` — see the same field on `Lead`.
  photo_storage_key String?
```

- [ ] **Step 3: Pick a migration timestamp that cannot collide**

Run: `ls packages/database/prisma/migrations | sort | tail -3`

Take the highest timestamp prefix you see and choose one strictly greater than it (e.g. if the newest is `20260810120000_x`, use `20260811090000`). Create the directory:

```bash
mkdir -p packages/database/prisma/migrations/20260811090000_add_crm_photos
```

- [ ] **Step 4: Write the migration SQL**

Create `packages/database/prisma/migrations/20260811090000_add_crm_photos/migration.sql`:

```sql
-- Optional profile photo for leads and contacts.
-- photo_storage_key holds Cloudinary's public_id: photo_url is a secure_url and
-- cannot be turned back into one, so without it a replaced photo is unreclaimable.
ALTER TABLE "Lead" ADD COLUMN "photo_url" TEXT;
ALTER TABLE "Lead" ADD COLUMN "photo_storage_key" TEXT;

ALTER TABLE "crm_contacts" ADD COLUMN "photo_url" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "photo_storage_key" TEXT;
```

**Before writing this, confirm the physical table names.** `CrmContact` has no `@@map` in the schema excerpt used to write this plan, while `CrmContactAttachment` maps to `crm_contact_attachments`. Run:

```bash
grep -n '@@map' packages/database/prisma/schema.prisma | grep -i contact
```

If `CrmContact` has no `@@map`, its table is `"CrmContact"` — change the last two statements to `ALTER TABLE "CrmContact"`. Verify against the live DB with:

```bash
docker exec erp71-db-1 psql -U postgres -d erp71 -c '\dt' | grep -i -E 'lead|contact'
```

- [ ] **Step 5: Apply the SQL to the local dev database**

`prisma migrate dev` will fail here — the local DB has no `_prisma_migrations` table. Apply directly instead (note port **5434**):

```bash
docker exec -i erp71-db-1 psql -U postgres -d erp71 \
  -f - < packages/database/prisma/migrations/20260811090000_add_crm_photos/migration.sql
```

Expected: four `ALTER TABLE` lines, no errors.

- [ ] **Step 6: Regenerate the Prisma client**

Run: `npm run db:generate --workspace=@erp71/database` (or `npx prisma generate --schema packages/database/prisma/schema.prisma` if that script does not exist — check `packages/database/package.json`)

Expected: "Generated Prisma Client".

- [ ] **Step 7: Verify the columns exist and are typed**

```bash
docker exec erp71-db-1 psql -U postgres -d erp71 -c \
  "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE column_name LIKE 'photo%' ORDER BY table_name;"
```

Expected: four rows, all `text`, across the two tables.

- [ ] **Step 8: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "$(cat <<'EOF'
feat(db): add photo columns to Lead and CrmContact

photo_storage_key holds Cloudinary's public_id alongside the URL, so a
replaced photo can be deleted rather than stranded.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Move `parseImageUpload` into a shared util

`parseImageUpload` currently lives in `crm-contacts.service.ts`. The new photo module needs it, and importing a service module to get a pure function is the wrong dependency. This task is a pure move with no behaviour change.

**Files:**

- Create: `apps/backend/src/common/image-upload.util.ts`
- Create: `apps/backend/src/common/image-upload.util.spec.ts`
- Modify: `apps/backend/src/crm-contacts/crm-contacts.service.ts:36-79` (remove the function and its two constants, import them instead)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `parseImageUpload(imageBase64: string, mimeType?: string): { buffer: Buffer; mimeType: string }`
  - `IMAGE_UPLOAD_MIME_TYPES: string[]`
  - `MAX_IMAGE_UPLOAD_BASE64_LENGTH: number`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/common/image-upload.util.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { parseImageUpload } from './image-upload.util';

// 1x1 transparent PNG.
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('parseImageUpload', () => {
    it('accepts a bare base64 string and defaults the mime type to JPEG', () => {
        const result = parseImageUpload(PNG_BASE64);
        expect(result.mimeType).toBe('image/jpeg');
        expect(result.buffer.byteLength).toBeGreaterThan(0);
    });

    it('reads the mime type out of a data: URL', () => {
        const result = parseImageUpload(`data:image/png;base64,${PNG_BASE64}`);
        expect(result.mimeType).toBe('image/png');
    });

    it('rejects an unsupported image type', () => {
        expect(() => parseImageUpload(`data:image/gif;base64,${PNG_BASE64}`)).toThrow(
            BadRequestException,
        );
    });

    it('rejects an empty payload', () => {
        expect(() => parseImageUpload('   ')).toThrow(BadRequestException);
    });

    it('rejects a payload that is not base64 at all', () => {
        // Buffer.from never throws on junk, it just yields fewer bytes — so a
        // zero-length result is the only signal the payload was never base64.
        expect(() => parseImageUpload('!!!!')).toThrow(BadRequestException);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest --config apps/backend/jest.config.js src/common/image-upload.util.spec.ts`

(If that config path does not exist, check `apps/backend/package.json` for the `test` script and use its config.)

Expected: FAIL — `Cannot find module './image-upload.util'`.

- [ ] **Step 3: Create the util by moving the existing code verbatim**

Create `apps/backend/src/common/image-upload.util.ts`. Copy the constants and function from `crm-contacts.service.ts` unchanged apart from the two constant renames:

```typescript
import { BadRequestException } from '@nestjs/common';

/** What Cloudinary is asked to store, and what a browser can render back. */
export const IMAGE_UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** ~7 MB of base64 ≈ a 5 MB image, just under the 5 MB JSON body limit's headroom. */
export const MAX_IMAGE_UPLOAD_BASE64_LENGTH = 7 * 1024 * 1024;

/**
 * Turn the browser's payload into bytes.
 *
 * Accepts a `data:` URL or a bare base64 string for the same reason the scan
 * route does — `FileReader.readAsDataURL` produces the former and expecting
 * every caller to strip the prefix is how one of them eventually forgets.
 */
export function parseImageUpload(
    imageBase64: string,
    mimeType?: string,
): { buffer: Buffer; mimeType: string } {
    const raw = (imageBase64 ?? '').trim();
    if (!raw) throw new BadRequestException('No image was provided.');

    let data = raw;
    let resolved = (mimeType ?? '').trim().toLowerCase();

    const dataUrl = raw.match(/^data:([^;,]+);base64,(.*)$/s);
    if (dataUrl) {
        resolved = dataUrl[1].toLowerCase();
        data = dataUrl[2];
    }

    if (!resolved) resolved = 'image/jpeg';
    if (!IMAGE_UPLOAD_MIME_TYPES.includes(resolved)) {
        throw new BadRequestException('Unsupported image type. Use a JPEG, PNG, or WebP image.');
    }
    if (data.length > MAX_IMAGE_UPLOAD_BASE64_LENGTH) {
        throw new BadRequestException('Image is too large to keep.');
    }

    const buffer = Buffer.from(data, 'base64');
    // Buffer.from never throws on junk — it just returns fewer bytes — so an
    // empty result is the only signal that the payload was not base64 at all.
    if (!buffer.byteLength) throw new BadRequestException('The image could not be read.');

    return { buffer, mimeType: resolved };
}
```

- [ ] **Step 4: Delete the original from the contacts service and import instead**

In `apps/backend/src/crm-contacts/crm-contacts.service.ts`:

1. Delete the `ATTACHMENT_MIME_TYPES` const, the `MAX_ATTACHMENT_BASE64_LENGTH` const, and the whole `export function parseImageUpload(...)` block (roughly lines 36–79).
2. Add to the imports near the top:

```typescript
import { parseImageUpload } from '../common/image-upload.util';
```

3. Leave the call site at what was line 239 (`const { buffer, mimeType } = parseImageUpload(dto.imageBase64, dto.mimeType);`) untouched.

- [ ] **Step 5: Run both suites to verify nothing broke**

Run: `npx jest --config apps/backend/jest.config.js src/common/image-upload.util.spec.ts src/crm-contacts`

Expected: PASS. The new util spec passes and every existing `crm-contacts.service.spec.ts` case still passes.

If any existing test imported `parseImageUpload` from the service, repoint it at `../common/image-upload.util`. (`grep -rn "parseImageUpload" apps/backend/src` showed only the definition and one call site when this plan was written, but re-check.)

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/common/image-upload.util.ts apps/backend/src/common/image-upload.util.spec.ts apps/backend/src/crm-contacts/crm-contacts.service.ts
git commit -m "$(cat <<'EOF'
refactor(backend): move parseImageUpload to common/image-upload.util

Pure move, no behaviour change. The upcoming CRM photo module needs it and
should not have to import the contacts service to get at a pure function.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The `crm-photos` module

**Files:**

- Create: `apps/backend/src/crm-photos/crm-photos.dto.ts`
- Create: `apps/backend/src/crm-photos/crm-photos.service.ts`
- Create: `apps/backend/src/crm-photos/crm-photos.controller.ts`
- Create: `apps/backend/src/crm-photos/crm-photos.module.ts`
- Create: `apps/backend/src/crm-photos/crm-photos.service.spec.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**

- Consumes: `parseImageUpload` from Task 2; `AssetsService.uploadBuffer(buffer, folder, fileName, resourceType)` and `AssetsService.isEnabled()` (existing).
- Produces:
  - `CrmPhotosService.upload(tenantId: string, dto: UploadCrmPhotoDto): Promise<{ url: string; storageKey: string }>`
  - `CrmPhotosService.assertTenantPhotoKey(tenantId: string, key: string | null | undefined): void` — throws `BadRequestException` for a key outside the tenant's folder; a nullish or empty key is allowed and is a no-op.
  - `crmPhotoFolder(tenantId: string): string` — returns `` `${tenantId}/crm-photos` `` (the folder passed to `uploadBuffer`, which prefixes `retail/` itself).
  - `crmPhotoKeyPrefix(tenantId: string): string` — returns `` `retail/${tenantId}/crm-photos/` `` (the full stored `public_id` prefix).
  - `class UploadCrmPhotoDto { imageBase64: string; mimeType?: string; fileName?: string }`
  - `CrmPhotosModule` — exports `CrmPhotosService`.
  - Route `POST /crm/photos`.

- [ ] **Step 1: Write the DTO**

Create `apps/backend/src/crm-photos/crm-photos.dto.ts`:

```typescript
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

export class UploadCrmPhotoDto {
    /** A `data:` URL or a bare base64 string. */
    @IsString()
    imageBase64: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    mimeType?: string;

    /** Used as the stored filename stem only; never shown to a user. */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(200)
    fileName?: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/backend/src/crm-photos/crm-photos.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { CrmPhotosService } from './crm-photos.service';
import { AssetsService } from '../assets/assets.service';

// 1x1 transparent PNG.
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('CrmPhotosService', () => {
    let service: CrmPhotosService;
    let assets: any;

    const TENANT = 'tenant-1';

    beforeEach(async () => {
        assets = {
            isEnabled: jest.fn().mockReturnValue(true),
            uploadBuffer: jest.fn().mockResolvedValue({
                url: 'https://cdn.example/photo.jpg',
                publicId: 'retail/tenant-1/crm-photos/photo',
                bytes: 4,
            }),
            deleteFile: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [CrmPhotosService, { provide: AssetsService, useValue: assets }],
        }).compile();

        service = module.get<CrmPhotosService>(CrmPhotosService);
    });

    describe('upload', () => {
        it('stores the image in the tenant folder and returns url + storage key', async () => {
            const result = await service.upload(TENANT, {
                imageBase64: `data:image/png;base64,${PNG_BASE64}`,
                fileName: 'Rahim Uddin.png',
            });

            expect(result).toEqual({
                url: 'https://cdn.example/photo.jpg',
                storageKey: 'retail/tenant-1/crm-photos/photo',
            });
            expect(assets.uploadBuffer).toHaveBeenCalledWith(
                expect.any(Buffer),
                'tenant-1/crm-photos',
                'Rahim-Uddin',
                'image',
            );
        });

        it('falls back to a safe stem when no filename is given', async () => {
            await service.upload(TENANT, { imageBase64: PNG_BASE64 });
            expect(assets.uploadBuffer).toHaveBeenCalledWith(
                expect.any(Buffer),
                'tenant-1/crm-photos',
                'photo',
                'image',
            );
        });

        it('fails clearly when storage is not configured', async () => {
            assets.isEnabled.mockReturnValue(false);
            await expect(service.upload(TENANT, { imageBase64: PNG_BASE64 })).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            expect(assets.uploadBuffer).not.toHaveBeenCalled();
        });

        it('reports an upload failure as unavailable rather than leaking the driver error', async () => {
            assets.uploadBuffer.mockRejectedValue(new Error('cloudinary exploded'));
            await expect(service.upload(TENANT, { imageBase64: PNG_BASE64 })).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
        });

        it('rejects an unsupported image type', async () => {
            await expect(
                service.upload(TENANT, { imageBase64: `data:image/gif;base64,${PNG_BASE64}` }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('assertTenantPhotoKey', () => {
        it('accepts a key inside the tenant folder', () => {
            expect(() =>
                service.assertTenantPhotoKey(TENANT, 'retail/tenant-1/crm-photos/abc'),
            ).not.toThrow();
        });

        it('treats an absent or cleared key as nothing to check', () => {
            expect(() => service.assertTenantPhotoKey(TENANT, null)).not.toThrow();
            expect(() => service.assertTenantPhotoKey(TENANT, undefined)).not.toThrow();
            expect(() => service.assertTenantPhotoKey(TENANT, '')).not.toThrow();
        });

        it("rejects another tenant's key — this is the cross-tenant delete vector", () => {
            expect(() =>
                service.assertTenantPhotoKey(TENANT, 'retail/tenant-2/crm-photos/abc'),
            ).toThrow(BadRequestException);
        });

        it('rejects a key in a different folder of the same tenant', () => {
            expect(() =>
                service.assertTenantPhotoKey(TENANT, 'retail/tenant-1/contact-cards/abc'),
            ).toThrow(BadRequestException);
        });

        it('rejects a key that only mentions the tenant folder later in the string', () => {
            expect(() =>
                service.assertTenantPhotoKey(TENANT, 'retail/tenant-2/x/retail/tenant-1/crm-photos/abc'),
            ).toThrow(BadRequestException);
        });
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest --config apps/backend/jest.config.js src/crm-photos`

Expected: FAIL — `Cannot find module './crm-photos.service'`.

- [ ] **Step 4: Write the service**

Create `apps/backend/src/crm-photos/crm-photos.service.ts`:

```typescript
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AssetsService } from '../assets/assets.service';
import { parseImageUpload } from '../common/image-upload.util';
import { UploadCrmPhotoDto } from './crm-photos.dto';

/**
 * Folder handed to `uploadBuffer`, which prefixes `retail/` itself. Kept
 * separate from the prefix below so the two can never drift apart.
 */
export function crmPhotoFolder(tenantId: string): string {
    return `${tenantId}/crm-photos`;
}

/** The full `public_id` prefix a stored CRM photo must carry. */
export function crmPhotoKeyPrefix(tenantId: string): string {
    return `retail/${crmPhotoFolder(tenantId)}/`;
}

@Injectable()
export class CrmPhotosService {
    constructor(private assets: AssetsService) {}

    /**
     * Store a cropped photo and hand back both the URL and Cloudinary's
     * `public_id`.
     *
     * The `public_id` matters: a `secure_url` cannot be turned back into one,
     * so a caller that keeps only the URL can never delete the asset again.
     * That is exactly the trap VoucherAttachment and ProjectAttachment are in.
     */
    async upload(
        tenantId: string,
        dto: UploadCrmPhotoDto,
    ): Promise<{ url: string; storageKey: string }> {
        const { buffer } = parseImageUpload(dto.imageBase64, dto.mimeType);

        if (!this.assets.isEnabled()) {
            // Distinguishable from a transient failure: this one will not fix
            // itself on retry, and the operator needs to know why.
            throw new ServiceUnavailableException(
                'File storage is not configured, so the photo could not be saved.',
            );
        }

        const stem = (dto.fileName ?? 'photo').replace(/\.[^.]+$/, '').slice(0, 100);
        const safeStem = stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';

        let stored: { url: string; publicId: string };
        try {
            stored = await this.assets.uploadBuffer(buffer, crmPhotoFolder(tenantId), safeStem, 'image');
        } catch {
            throw new ServiceUnavailableException('The photo could not be uploaded. Try again.');
        }

        return { url: stored.url, storageKey: stored.publicId };
    }

    /**
     * Refuse a storage key that is not this tenant's.
     *
     * `photo_storage_key` arrives from the client and is fed straight to
     * `cloudinary.destroy` when a photo is replaced. Unchecked, tenant A could
     * point a lead at tenant B's `public_id` and delete B's asset simply by
     * changing the photo. A blank key is not an attack — it is "no photo".
     */
    assertTenantPhotoKey(tenantId: string, key: string | null | undefined): void {
        if (!key) return;
        if (!key.startsWith(crmPhotoKeyPrefix(tenantId))) {
            throw new BadRequestException('That photo does not belong to this account.');
        }
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest --config apps/backend/jest.config.js src/crm-photos`

Expected: PASS — all 10 cases.

- [ ] **Step 6: Write the controller**

Create `apps/backend/src/crm-photos/crm-photos.controller.ts`:

```typescript
import { Body, Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CrmPhotosService } from './crm-photos.service';
import { UploadCrmPhotoDto } from './crm-photos.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

/**
 * Photo uploads for leads and contacts alike, which is why this is its own
 * module rather than a route on either: the photo is picked before the record
 * it belongs to exists, so it cannot hang off `/crm/leads/:id`.
 */
@Controller('crm/photos')
@UseGuards(JwtAuthGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmPhotosController {
    constructor(private readonly service: CrmPhotosService) {}

    /** Throttled like the card-attachment route: the body carries an image. */
    @Post()
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    upload(@Tenant() tenant: TenantContext, @Body() dto: UploadCrmPhotoDto) {
        return this.service.upload(tenant.tenantId, dto);
    }
}
```

- [ ] **Step 7: Write the module**

Create `apps/backend/src/crm-photos/crm-photos.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { CrmPhotosController } from './crm-photos.controller';
import { CrmPhotosService } from './crm-photos.service';
import { AssetsModule } from '../assets/assets.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';

@Module({
    imports: [AssetsModule],
    controllers: [CrmPhotosController],
    providers: [CrmPhotosService, SubscriptionAccessGuard],
    // Exported so the leads and contacts services can reuse
    // `assertTenantPhotoKey` rather than each re-deriving the prefix rule.
    exports: [CrmPhotosService],
})
export class CrmPhotosModule {}
```

- [ ] **Step 8: Register the module**

In `apps/backend/src/app.module.ts`, add the import beside the other CRM imports (near line 93–100):

```typescript
import { CrmPhotosModule } from './crm-photos/crm-photos.module';
```

and add `CrmPhotosModule,` to the `imports` array beside `CrmContactsModule` / `CrmLeadsModule` (near line 210–217).

- [ ] **Step 9: Verify the app still boots and the route is registered**

Run: `npm run build --workspace=apps/backend`

Expected: compiles with no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/crm-photos apps/backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(crm): add POST /crm/photos upload endpoint

Returns Cloudinary's public_id alongside the URL so a replaced photo can be
reclaimed. assertTenantPhotoKey refuses a storage key outside the tenant's own
folder — without it a client could point a record at another tenant's asset and
delete it by changing the photo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Contacts service — persist, replace and reclaim the photo

**Files:**

- Modify: `apps/backend/src/crm-contacts/crm-contacts.dto.ts` (`CreateContactDto`, `UpdateContactDto`)
- Modify: `apps/backend/src/crm-contacts/crm-contacts.service.ts` (`OPTIONAL_TEXT_FIELDS` ~line 90, `create` ~line 146, `update` ~line 322, `remove` ~line 354, `bulkAction` ~line 365, new `purgePhotoAssets`)
- Modify: `apps/backend/src/crm-contacts/crm-contacts.module.ts`
- Modify: `apps/backend/src/crm-contacts/crm-contacts.service.spec.ts`

**Interfaces:**

- Consumes: `CrmPhotosService.assertTenantPhotoKey` and `CrmPhotosModule` from Task 3; the `photo_url` / `photo_storage_key` columns from Task 1.
- Produces: `POST /crm/contacts` and `PATCH /crm/contacts/:id` accept `photo_url` and `photo_storage_key`; `''` on either clears it. Contact responses carry both fields (they arrive automatically via `contactIncludes`, which is an `include`, so all scalars are returned).

- [ ] **Step 1: Write the failing tests**

Append these cases to `apps/backend/src/crm-contacts/crm-contacts.service.spec.ts`, inside the top-level `describe('CrmContactsService', ...)`:

```typescript
    describe('photos', () => {
        const KEY = 'retail/tenant-1/crm-photos/rahim';
        const OTHER_KEY = 'retail/tenant-1/crm-photos/newer';

        it('stores the photo url and key on create', async () => {
            const created = await service.create(TENANT, USER, {
                name: 'Rahim',
                photo_url: 'https://cdn.example/rahim.jpg',
                photo_storage_key: KEY,
            } as any);

            expect(created.photo_url).toBe('https://cdn.example/rahim.jpg');
            expect(created.photo_storage_key).toBe(KEY);
        });

        it("refuses a storage key from another tenant's folder", async () => {
            await expect(
                service.create(TENANT, USER, {
                    name: 'Rahim',
                    photo_url: 'https://cdn.example/rahim.jpg',
                    photo_storage_key: 'retail/tenant-2/crm-photos/rahim',
                } as any),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.crmContact.create).not.toHaveBeenCalled();
        });

        it('deletes the previous asset when the photo is replaced', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1', photo_storage_key: KEY });

            await service.update(TENANT, 'contact-1', {
                photo_url: 'https://cdn.example/newer.jpg',
                photo_storage_key: OTHER_KEY,
            } as any);

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('deletes the previous asset when the photo is cleared', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1', photo_storage_key: KEY });

            const updated = await service.update(TENANT, 'contact-1', {
                photo_url: '',
                photo_storage_key: '',
            } as any);

            expect(updated.photo_url).toBeNull();
            expect(updated.photo_storage_key).toBeNull();
            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('deletes nothing when an update does not touch the photo', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1', photo_storage_key: KEY });

            await service.update(TENANT, 'contact-1', { name: 'Rahim Uddin' } as any);

            expect(assets.deleteFile).not.toHaveBeenCalled();
        });

        it('deletes nothing when the same photo is sent back unchanged', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1', photo_storage_key: KEY });

            await service.update(TENANT, 'contact-1', {
                photo_url: 'https://cdn.example/rahim.jpg',
                photo_storage_key: KEY,
            } as any);

            expect(assets.deleteFile).not.toHaveBeenCalled();
        });

        it('reclaims the photo when the contact is deleted', async () => {
            db.crmContact.findFirst.mockResolvedValue({ id: 'contact-1' });
            db.crmContact.findMany.mockResolvedValue([{ photo_storage_key: KEY }]);

            await service.remove(TENANT, 'contact-1');

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('reclaims photos on a bulk delete', async () => {
            db.crmContact.findMany.mockResolvedValue([
                { photo_storage_key: KEY },
                { photo_storage_key: OTHER_KEY },
            ]);

            await service.bulkAction(TENANT, {
                ids: ['contact-1', 'contact-2'],
                action: ContactBulkAction.DELETE,
            } as any);

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
            expect(assets.deleteFile).toHaveBeenCalledWith(OTHER_KEY);
        });
    });
```

Also add `CrmPhotosService` to the spec's testing module providers, so the service can be constructed:

```typescript
import { CrmPhotosService } from '../crm-photos/crm-photos.service';
```

and in `Test.createTestingModule({ providers: [...] })` add:

```typescript
                { provide: CrmPhotosService, useValue: new CrmPhotosService(assets as any) },
```

(Using the real `CrmPhotosService` rather than a stub keeps the cross-tenant test honest — it exercises the actual prefix rule.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --config apps/backend/jest.config.js src/crm-contacts`

Expected: FAIL — the new cases fail (photo fields are dropped, `deleteFile` never called). Existing cases still pass.

- [ ] **Step 3: Add the DTO fields**

In `apps/backend/src/crm-contacts/crm-contacts.dto.ts`, add to **both** `CreateContactDto` and `UpdateContactDto`, after the `linkedin_url` field:

```typescript
    /**
     * Set from the photo picker, which uploads to `POST /crm/photos` first.
     * `''` clears the photo — deliberately not run through `emptyToUndefined`,
     * which the service would read as "leave it alone" and make a photo
     * impossible to remove once set.
     */
    @IsOptional()
    @IsString()
    photo_url?: string;

    @IsOptional()
    @IsString()
    photo_storage_key?: string;
```

- [ ] **Step 4: Wire the module**

In `apps/backend/src/crm-contacts/crm-contacts.module.ts`, add the import and list it:

```typescript
import { CrmPhotosModule } from '../crm-photos/crm-photos.module';
```

and change the `imports` array to `imports: [AiModule, AssetsModule, CrmPhotosModule],`.

- [ ] **Step 5: Implement the service changes**

In `apps/backend/src/crm-contacts/crm-contacts.service.ts`:

1. Add the import:

```typescript
import { CrmPhotosService } from '../crm-photos/crm-photos.service';
```

2. Add `photo_url` to the `OPTIONAL_TEXT_FIELDS` list (so `mapTextFields` trims it and turns `''` into `null` like every other optional text column):

```typescript
const OPTIONAL_TEXT_FIELDS = [
    'company',
    'designation',
    'mobile',
    'phone',
    'email',
    'address',
    'website_url',
    'linkedin_url',
    'notes',
    'photo_url',
] as const;
```

3. Add `CrmPhotosService` to the constructor:

```typescript
    constructor(
        private db: DatabaseService,
        private ai: AiService,
        private assets: AssetsService,
        private photos: CrmPhotosService,
    ) {}
```

4. Add a private helper next to `purgeAttachmentAssets`:

```typescript
    /**
     * Normalise the photo key and refuse one that is not this tenant's.
     *
     * Returns `undefined` when the field was absent (leave it alone), `null`
     * when it was explicitly cleared, and the key otherwise.
     */
    private resolvePhotoKey(
        tenantId: string,
        key: string | undefined,
    ): string | null | undefined {
        if (key === undefined) return undefined;
        const trimmed = key.trim();
        if (!trimmed) return null;
        this.photos.assertTenantPhotoKey(tenantId, trimmed);
        return trimmed;
    }

    /**
     * Drop the Cloudinary photos for contacts about to be deleted. The rows go
     * on their own via cascade, but Cloudinary knows nothing about that.
     */
    private async purgePhotoAssets(tenantId: string, contactIds: string[]) {
        if (!contactIds.length) return;
        const rows = await this.db.crmContact.findMany({
            where: { tenant_id: tenantId, id: { in: contactIds } },
            select: { photo_storage_key: true },
        });
        await Promise.all(
            rows
                .map((row) => row.photo_storage_key)
                .filter((key): key is string => !!key)
                .map((key) => this.assets.deleteFile(key)),
        );
    }
```

5. In `create`, after the mobile check and before `this.db.crmContact.create`, add:

```typescript
        const photoKey = this.resolvePhotoKey(tenantId, dto.photo_storage_key);
```

and inside the `data` object, after `assigned_to`:

```typescript
                photo_storage_key: photoKey ?? null,
```

(`photo_url` is already handled by the `...this.mapTextFields(dto)` spread.)

6. In `update`, after the `assigned_to` block and before `this.db.crmContact.update`, add:

```typescript
        const photoKey = this.resolvePhotoKey(tenantId, dto.photo_storage_key);
        if (photoKey !== undefined) data.photo_storage_key = photoKey;
```

Then change the `existing` lookup at the top of `update` to fetch the current key:

```typescript
        const existing = await this.db.crmContact.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true, photo_storage_key: true },
        });
```

and replace the closing `return this.db.crmContact.update({...})` with:

```typescript
        const updated = await this.db.crmContact.update({
            where: { id },
            data,
            include: contactIncludes,
        });

        // After the row, not before: a failed delete here leaves a stray file,
        // while a failed delete the other way round leaves a row pointing at
        // nothing. Only when the key actually changed — re-saving a form with
        // an untouched photo must not delete the photo it is still using.
        if (
            photoKey !== undefined &&
            existing.photo_storage_key &&
            existing.photo_storage_key !== photoKey
        ) {
            await this.assets.deleteFile(existing.photo_storage_key);
        }

        return updated;
```

7. In `remove`, add the photo purge beside the attachment purge:

```typescript
        await this.purgeAttachmentAssets(tenantId, [id]);
        await this.purgePhotoAssets(tenantId, [id]);
```

8. In `bulkAction`'s `DELETE` branch, likewise:

```typescript
            await this.purgeAttachmentAssets(tenantId, dto.ids);
            await this.purgePhotoAssets(tenantId, dto.ids);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest --config apps/backend/jest.config.js src/crm-contacts`

Expected: PASS — the eight new cases and every pre-existing case.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/crm-contacts
git commit -m "$(cat <<'EOF'
feat(crm): persist contact photos and reclaim replaced ones

Create/update accept photo_url and photo_storage_key; an empty string clears
them. Replacing or clearing a photo deletes the previous Cloudinary asset, as
does deleting the contact. Storage keys outside the tenant's own folder are
rejected before they can reach cloudinary.destroy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Leads service — persist, replace and reclaim the photo

Same shape as Task 4, but the leads service has **no `AssetsService` today** — it must be injected, and `AssetsModule` added to the module's imports.

**Files:**

- Modify: `apps/backend/src/crm-leads/crm-leads.dto.ts` (`CreateLeadDto`, `UpdateLeadDto`)
- Modify: `apps/backend/src/crm-leads/crm-leads.service.ts` (constructor, `mapLeadData`, `create` ~line 140, `update` ~line 326, `remove` ~line 391, `bulkAction` ~line 399)
- Modify: `apps/backend/src/crm-leads/crm-leads.module.ts`
- Modify: `apps/backend/src/crm-leads/crm-leads.service.spec.ts`

**Interfaces:**

- Consumes: `CrmPhotosService.assertTenantPhotoKey` (Task 3); `AssetsService.deleteFile` (existing); the columns from Task 1.
- Produces: `POST /crm/leads` and `PATCH /crm/leads/:id` accept `photo_url` and `photo_storage_key`; `''` on either clears it. Lead responses carry both (via `leadIncludes`, an `include`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/src/crm-leads/crm-leads.service.spec.ts`, inside the top-level describe. **Read the existing file first** — reuse its `TENANT`/`USER` constants and its `db` mock shape rather than the names below if they differ.

```typescript
    describe('photos', () => {
        const KEY = 'retail/tenant-1/crm-photos/rahim';
        const OTHER_KEY = 'retail/tenant-1/crm-photos/newer';

        it('stores the photo url and key on create', async () => {
            const created = await service.create(TENANT, USER, {
                name: 'Rahim',
                photo_url: 'https://cdn.example/rahim.jpg',
                photo_storage_key: KEY,
            } as any);

            expect(created.photo_url).toBe('https://cdn.example/rahim.jpg');
            expect(created.photo_storage_key).toBe(KEY);
        });

        it("refuses a storage key from another tenant's folder", async () => {
            await expect(
                service.create(TENANT, USER, {
                    name: 'Rahim',
                    photo_url: 'https://cdn.example/rahim.jpg',
                    photo_storage_key: 'retail/tenant-2/crm-photos/rahim',
                } as any),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.lead.create).not.toHaveBeenCalled();
        });

        it('deletes the previous asset when the photo is replaced', async () => {
            db.lead.findFirst.mockResolvedValue({
                id: 'lead-1',
                status: 'NEW',
                priority: 'MEDIUM',
                photo_storage_key: KEY,
            });

            await service.update(TENANT, 'lead-1', {
                photo_url: 'https://cdn.example/newer.jpg',
                photo_storage_key: OTHER_KEY,
            } as any);

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('deletes the previous asset when the photo is cleared', async () => {
            db.lead.findFirst.mockResolvedValue({
                id: 'lead-1',
                status: 'NEW',
                priority: 'MEDIUM',
                photo_storage_key: KEY,
            });

            const updated = await service.update(TENANT, 'lead-1', {
                photo_url: '',
                photo_storage_key: '',
            } as any);

            expect(updated.photo_url).toBeNull();
            expect(updated.photo_storage_key).toBeNull();
            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('deletes nothing when an update does not touch the photo', async () => {
            db.lead.findFirst.mockResolvedValue({
                id: 'lead-1',
                status: 'NEW',
                priority: 'MEDIUM',
                photo_storage_key: KEY,
            });

            await service.update(TENANT, 'lead-1', { name: 'Rahim Uddin' } as any);

            expect(assets.deleteFile).not.toHaveBeenCalled();
        });

        it('reclaims the photo when the lead is deleted', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'lead-1', status: 'NEW' });
            db.lead.findMany.mockResolvedValue([{ photo_storage_key: KEY }]);

            await service.remove(TENANT, 'lead-1');

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('reclaims photos on a bulk delete', async () => {
            db.lead.findMany.mockResolvedValue([
                { photo_storage_key: KEY },
                { photo_storage_key: OTHER_KEY },
            ]);

            await service.bulkAction(TENANT, {
                ids: ['lead-1', 'lead-2'],
                action: LeadBulkAction.DELETE,
            } as any);

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
            expect(assets.deleteFile).toHaveBeenCalledWith(OTHER_KEY);
        });
    });
```

Add to the spec's imports and providers:

```typescript
import { AssetsService } from '../assets/assets.service';
import { CrmPhotosService } from '../crm-photos/crm-photos.service';
```

```typescript
        assets = {
            isEnabled: jest.fn().mockReturnValue(true),
            uploadBuffer: jest.fn(),
            deleteFile: jest.fn().mockResolvedValue(undefined),
        };
```

```typescript
                { provide: AssetsService, useValue: assets },
                { provide: CrmPhotosService, useValue: new CrmPhotosService(assets as any) },
```

Declare `let assets: any;` beside the other mock declarations.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --config apps/backend/jest.config.js src/crm-leads`

Expected: FAIL on the new cases; existing cases pass.

- [ ] **Step 3: Add the DTO fields**

In `apps/backend/src/crm-leads/crm-leads.dto.ts`, add to **both** `CreateLeadDto` and `UpdateLeadDto`, beside `website_url`:

```typescript
    /**
     * Set from the photo picker, which uploads to `POST /crm/photos` first.
     * `''` clears the photo rather than meaning "leave it alone" — otherwise a
     * photo could never be removed once set.
     */
    @IsOptional()
    @IsString()
    photo_url?: string;

    @IsOptional()
    @IsString()
    photo_storage_key?: string;
```

- [ ] **Step 4: Wire the module**

In `apps/backend/src/crm-leads/crm-leads.module.ts`:

```typescript
import { AssetsModule } from '../assets/assets.module';
import { CrmPhotosModule } from '../crm-photos/crm-photos.module';
```

and change the imports array to:

```typescript
    imports: [CustomersModule, CustomFieldsModule, CrmLeadTaxonomyModule, AssetsModule, CrmPhotosModule],
```

- [ ] **Step 5: Implement the service changes**

In `apps/backend/src/crm-leads/crm-leads.service.ts`:

1. Add imports:

```typescript
import { AssetsService } from '../assets/assets.service';
import { CrmPhotosService } from '../crm-photos/crm-photos.service';
```

2. Extend the constructor:

```typescript
    constructor(
        private db: DatabaseService,
        private customersService: CustomersService,
        private customFields: CustomFieldsService,
        private taxonomy: CrmLeadTaxonomyService,
        private assets: AssetsService,
        private photos: CrmPhotosService,
    ) {}
```

3. Add the same two private helpers used by the contacts service, adapted to `lead`:

```typescript
    /**
     * Normalise the photo fields and refuse a key that is not this tenant's.
     *
     * Each returns `undefined` when the field was absent (leave it alone),
     * `null` when explicitly cleared, and the value otherwise.
     */
    private resolvePhoto(
        tenantId: string,
        dto: CreateLeadDto | UpdateLeadDto,
    ): { url: string | null | undefined; key: string | null | undefined } {
        const rawUrl = (dto as { photo_url?: string }).photo_url;
        const rawKey = (dto as { photo_storage_key?: string }).photo_storage_key;

        const url = rawUrl === undefined ? undefined : rawUrl.trim() || null;

        let key: string | null | undefined;
        if (rawKey === undefined) {
            key = undefined;
        } else {
            const trimmed = rawKey.trim();
            if (!trimmed) {
                key = null;
            } else {
                this.photos.assertTenantPhotoKey(tenantId, trimmed);
                key = trimmed;
            }
        }

        return { url, key };
    }

    /**
     * Drop the Cloudinary photos for leads about to be deleted. The rows go on
     * their own, but Cloudinary knows nothing about that.
     */
    private async purgePhotoAssets(tenantId: string, leadIds: string[]) {
        if (!leadIds.length) return;
        const rows = await this.db.lead.findMany({
            where: { tenant_id: tenantId, id: { in: leadIds } },
            select: { photo_storage_key: true },
        });
        await Promise.all(
            rows
                .map((row) => row.photo_storage_key)
                .filter((key): key is string => !!key)
                .map((key) => this.assets.deleteFile(key)),
        );
    }
```

4. Strip the photo fields out of `mapLeadData` so the generic `...rest` spread cannot write an untrimmed `''` into the columns — they are set explicitly instead:

```typescript
        const {
            custom_fields: _ignoredCustomFields,
            source: _ignoredSource,
            category: _ignoredCategory,
            photo_url: _ignoredPhotoUrl,
            photo_storage_key: _ignoredPhotoKey,
            ...rest
        } = dto as any;
```

5. In `create`, before `this.db.lead.create`:

```typescript
        const photo = this.resolvePhoto(tenantId, dto);
```

and inside the `data` object:

```typescript
                photo_url: photo.url ?? null,
                photo_storage_key: photo.key ?? null,
```

6. In `update`, after `const data = this.mapLeadData(dto);`:

```typescript
        const photo = this.resolvePhoto(tenantId, dto);
        if (photo.url !== undefined) data.photo_url = photo.url;
        if (photo.key !== undefined) data.photo_storage_key = photo.key;
```

and replace the closing `return this.db.lead.update({...})` with:

```typescript
        const updated = await this.db.lead.update({
            where: { id },
            data,
            include: leadIncludes,
        });

        // After the row, not before: a failed delete here leaves a stray file,
        // while the other order leaves a row pointing at nothing. Only when the
        // key actually changed — re-saving a form with an untouched photo must
        // not delete the photo it is still using.
        if (
            photo.key !== undefined &&
            existing.photo_storage_key &&
            existing.photo_storage_key !== photo.key
        ) {
            await this.assets.deleteFile(existing.photo_storage_key);
        }

        return updated;
```

`update` already loads the whole row (`findFirst({ where: { id, tenant_id: tenantId } })` with no `select`), so `existing.photo_storage_key` is available with no change to that query.

7. In `remove`, before the delete:

```typescript
        await this.purgePhotoAssets(tenantId, [id]);
        await this.db.lead.delete({ where: { id } });
```

8. In `bulkAction`'s `DELETE` branch:

```typescript
        if (action === LeadBulkAction.DELETE) {
            await this.purgePhotoAssets(tenantId, ids);
            const res = await this.db.lead.deleteMany({ where });
            return { count: res.count };
        }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest --config apps/backend/jest.config.js src/crm-leads`

Expected: PASS — seven new cases plus every pre-existing case.

- [ ] **Step 7: Run the whole backend suite for regressions**

Run: `npm test --workspace=apps/backend`

Expected: no new failures. The four `test/*.spec.ts` integration suites are known-broken independently of this work (see TODO.md) — if they were failing before your change, they may still fail. Confirm by checking `git stash && npm test --workspace=apps/backend` if unsure.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/crm-leads
git commit -m "$(cat <<'EOF'
feat(crm): persist lead photos and reclaim replaced ones

Mirrors the contact photo handling: create/update accept photo_url and
photo_storage_key, an empty string clears them, and the previous Cloudinary
asset is deleted on replace, clear, and delete. The leads service gains
AssetsService, which it did not have before.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `Avatar` component

**Files:**

- Create: `apps/frontend/src/components/Avatar.tsx`
- Create: `apps/frontend/src/components/Avatar.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces:

```typescript
type AvatarProps = {
    src?: string | null;
    name: string;
    size?: 'sm' | 'lg';
    className?: string;
};
export default function Avatar(props: Readonly<AvatarProps>): JSX.Element;
export function initialsOf(name: string): string;
```

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/Avatar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import Avatar, { initialsOf } from './Avatar';

describe('initialsOf', () => {
    it('takes the first letter of the first two words', () => {
        expect(initialsOf('Rahim Uddin')).toBe('RU');
    });

    it('caps at two letters however many words there are', () => {
        expect(initialsOf('Md Rahim Uddin Khan')).toBe('MR');
    });

    it('handles a single name', () => {
        expect(initialsOf('Rahim')).toBe('R');
    });

    it('falls back to a placeholder for a blank name', () => {
        expect(initialsOf('   ')).toBe('?');
    });

    it('ignores extra whitespace between words', () => {
        expect(initialsOf('Rahim    Uddin')).toBe('RU');
    });
});

describe('Avatar', () => {
    it('renders the photo when there is one', () => {
        render(<Avatar src="https://cdn.example/rahim.jpg" name="Rahim Uddin" />);
        const img = screen.getByRole('img', { name: 'Rahim Uddin' });
        expect(img).toHaveAttribute('src', 'https://cdn.example/rahim.jpg');
    });

    it('renders initials when there is no photo', () => {
        render(<Avatar src={null} name="Rahim Uddin" />);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByText('RU')).toBeInTheDocument();
    });

    it('treats an empty string as no photo', () => {
        render(<Avatar src="" name="Rahim Uddin" />);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace=apps/frontend -- Avatar`

Expected: FAIL — `Cannot find module './Avatar'`.

- [ ] **Step 3: Write the component**

Create `apps/frontend/src/components/Avatar.tsx`:

```tsx
'use client';

/**
 * Up to two initials for the fallback circle. Two, not more: at 32px a third
 * letter is unreadable, and the point is to be recognisable at a glance in a
 * list row rather than to encode the whole name.
 */
export function initialsOf(name: string): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
}

const SIZES = {
    sm: 'w-8 h-8 text-xs',
    lg: 'w-16 h-16 text-lg',
} as const;

type AvatarProps = {
    src?: string | null;
    name: string;
    size?: keyof typeof SIZES;
    className?: string;
};

/**
 * A person's photo, or their initials when there is none. Purely
 * presentational — uploading lives in `PhotoField`.
 */
export default function Avatar({
    src,
    name,
    size = 'sm',
    className = '',
}: Readonly<AvatarProps>) {
    const dimensions = SIZES[size];

    if (src) {
        // eslint-disable-next-line @next/next/no-img-element -- Cloudinary URLs
        // are not in next.config's remotePatterns, and a 32px list avatar gains
        // nothing from the optimiser.
        return (
            <img
                src={src}
                alt={name}
                className={`${dimensions} rounded-full object-cover flex-shrink-0 bg-gray-100 ${className}`}
            />
        );
    }

    return (
        <span
            aria-hidden="true"
            className={`${dimensions} rounded-full flex-shrink-0 inline-flex items-center justify-center bg-blue-50 text-blue-700 font-semibold ${className}`}
        >
            {initialsOf(name)}
        </span>
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=apps/frontend -- Avatar`

Expected: PASS — all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/Avatar.tsx apps/frontend/src/components/Avatar.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add Avatar component

Photo or initials in a circle, shared by the CRM list rows and the photo
picker. The initials fallback is capped at two letters — a third is unreadable
at the 32px list size.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `uploadCrmPhoto` API helper and i18n keys

Both are small, both are needed by Task 8, and neither is independently reviewable — so they land together.

**Files:**

- Modify: `apps/frontend/src/lib/api.ts` (beside `uploadFile`, ~line 856)
- Modify: `apps/frontend/src/lib/localization/messages/en/crmHr.ts`
- Modify: `apps/frontend/src/lib/localization/messages/bn/crmHr.ts`
- Modify: `apps/frontend/src/lib/localization/messages/ms/crmHr.ts`

**Interfaces:**

- Consumes: `POST /crm/photos` from Task 3.
- Produces:
  - `api.uploadCrmPhoto(body: { imageBase64: string; mimeType?: string; fileName?: string }): Promise<{ url: string; storageKey: string }>`
  - i18n keys `t.crm.contacts.photo.*` and `t.crm.leads.photo.*`, each with: `label`, `add`, `change`, `remove`, `hint`, `uploading`, `uploadFailed`, `tooLarge`, `notAnImage`, `cropTitle`, `cropConfirm`.

- [ ] **Step 1: Add the API helper**

In `apps/frontend/src/lib/api.ts`, directly after the existing `uploadFile` entry, add:

```typescript
    /**
     * Store a cropped lead/contact photo and get back both its URL and
     * Cloudinary's public_id. The record it belongs to may not exist yet, which
     * is why this is not a route on /crm/leads or /crm/contacts.
     */
    uploadCrmPhoto: (body: { imageBase64: string; mimeType?: string; fileName?: string }) =>
        fetchWithAuth('/crm/photos', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        }),
```

- [ ] **Step 2: Add the English keys**

In `apps/frontend/src/lib/localization/messages/en/crmHr.ts`, inside the `contacts:` object (beside `validation:` and `fields:`), add:

```typescript
            photo: {
                label: 'Photo',
                add: 'Add photo',
                change: 'Change photo',
                remove: 'Remove',
                hint: 'JPG, PNG or WebP, up to 5 MB. You can crop before saving.',
                uploading: 'Uploading...',
                uploadFailed: 'The photo could not be uploaded.',
                tooLarge: 'That image is larger than 5 MB. Choose a smaller one.',
                notAnImage: 'Choose an image file.',
                cropTitle: 'Crop photo',
                cropConfirm: 'Use photo',
            },
```

Add the **same block** inside the `leads:` object in the same file.

- [ ] **Step 3: Add the Bengali keys**

In `apps/frontend/src/lib/localization/messages/bn/crmHr.ts`, add to both `contacts:` and `leads:`:

```typescript
            photo: {
                label: 'ছবি',
                add: 'ছবি যোগ করুন',
                change: 'ছবি পরিবর্তন',
                remove: 'সরান',
                hint: 'JPG, PNG বা WebP, সর্বোচ্চ ৫ MB। সংরক্ষণের আগে ক্রপ করতে পারবেন।',
                uploading: 'আপলোড হচ্ছে...',
                uploadFailed: 'ছবিটি আপলোড করা যায়নি।',
                tooLarge: 'ছবিটি ৫ MB-এর বেশি। ছোট একটি বেছে নিন।',
                notAnImage: 'একটি ছবি ফাইল বেছে নিন।',
                cropTitle: 'ছবি ক্রপ করুন',
                cropConfirm: 'এই ছবি ব্যবহার করুন',
            },
```

- [ ] **Step 4: Add the Malay keys**

In `apps/frontend/src/lib/localization/messages/ms/crmHr.ts`, add to both `contacts:` and `leads:`:

```typescript
            photo: {
                label: 'Foto',
                add: 'Tambah foto',
                change: 'Tukar foto',
                remove: 'Buang',
                hint: 'JPG, PNG atau WebP, sehingga 5 MB. Anda boleh pangkas sebelum menyimpan.',
                uploading: 'Memuat naik...',
                uploadFailed: 'Foto tidak dapat dimuat naik.',
                tooLarge: 'Imej itu lebih besar daripada 5 MB. Pilih yang lebih kecil.',
                notAnImage: 'Pilih fail imej.',
                cropTitle: 'Pangkas foto',
                cropConfirm: 'Guna foto',
            },
```

- [ ] **Step 5: Verify the catalogs still typecheck and stay in sync**

Run: `npm run build --workspace=apps/frontend`

Expected: compiles. `MessageDictionary` is derived from the English catalog, so a key missing from `bn` or `ms` is a type error — if the build complains about a missing key, you skipped one.

- [ ] **Step 6: Run the i18n test**

Run: `npm test --workspace=apps/frontend -- i18n`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/lib/api.ts apps/frontend/src/lib/localization/messages
git commit -m "$(cat <<'EOF'
feat(crm): add uploadCrmPhoto helper and photo i18n keys

Keys land in en, bn and ms together — MessageDictionary is derived from the
English catalog, so a missing translation is a build error rather than a
silently English string.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `PhotoField` component

**Files:**

- Create: `apps/frontend/src/components/PhotoField.tsx`
- Create: `apps/frontend/src/components/PhotoField.test.tsx`

**Interfaces:**

- Consumes: `Avatar` (Task 6); `api.uploadCrmPhoto` (Task 7); the existing `AvatarCropModal` (`imageSrc`, `open`, `title`, `confirmLabel`, `cancelLabel`, `onClose`, `onConfirm: (file: File) => Promise<void>`); `toast` from `@/lib/toast`.
- Produces:

```typescript
export type PhotoValue = { url: string; storageKey: string };
type PhotoFieldProps = {
    value: PhotoValue;
    name: string;
    onChange: (value: PhotoValue) => void;
    labels: {
        label: string; add: string; change: string; remove: string; hint: string;
        uploading: string; uploadFailed: string; tooLarge: string; notAnImage: string;
        cropTitle: string; cropConfirm: string;
    };
    cancelLabel: string;
};
export default function PhotoField(props: Readonly<PhotoFieldProps>): JSX.Element;
export const MAX_PHOTO_BYTES: number; // 5 * 1024 * 1024
```

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/PhotoField.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhotoField, { type PhotoValue } from './PhotoField';

const mockUpload = jest.fn();
jest.mock('@/lib/api', () => ({
    api: { uploadCrmPhoto: (...args: any[]) => mockUpload(...args) },
}));

const mockToastError = jest.fn();
jest.mock('@/lib/toast', () => ({
    toast: { error: (...args: any[]) => mockToastError(...args) },
}));

// The real cropper pulls in react-easy-crop and a canvas. The behaviour under
// test is what PhotoField does with the cropped file, so the modal is reduced
// to a button that hands one back.
jest.mock('./AvatarCropModal', () => ({
    __esModule: true,
    default: ({ open, onConfirm }: any) =>
        open ? (
            <button
                type="button"
                onClick={() => onConfirm(new File(['x'], 'cropped.jpg', { type: 'image/jpeg' }))}
            >
                confirm-crop
            </button>
        ) : null,
}));

const LABELS = {
    label: 'Photo',
    add: 'Add photo',
    change: 'Change photo',
    remove: 'Remove',
    hint: 'JPG, PNG or WebP, up to 5 MB.',
    uploading: 'Uploading...',
    uploadFailed: 'The photo could not be uploaded.',
    tooLarge: 'That image is larger than 5 MB. Choose a smaller one.',
    notAnImage: 'Choose an image file.',
    cropTitle: 'Crop photo',
    cropConfirm: 'Use photo',
};

const EMPTY: PhotoValue = { url: '', storageKey: '' };

function setup(value: PhotoValue = EMPTY) {
    const onChange = jest.fn();
    render(
        <PhotoField
            value={value}
            name="Rahim Uddin"
            onChange={onChange}
            labels={LABELS}
            cancelLabel="Cancel"
        />,
    );
    return { onChange };
}

function pickFile(bytes = 'x', type = 'image/jpeg') {
    const input = screen.getByTestId('photo-field-input') as HTMLInputElement;
    const file = new File([bytes], 'rahim.jpg', { type });
    return userEvent.upload(input, file);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUpload.mockResolvedValue({
        url: 'https://cdn.example/rahim.jpg',
        storageKey: 'retail/tenant-1/crm-photos/rahim',
    });
});

describe('PhotoField', () => {
    it('shows the add action and no remove action when empty', () => {
        setup();
        expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });

    it('uploads the cropped file and reports the url and key', async () => {
        const { onChange } = setup();

        await pickFile();
        await userEvent.click(await screen.findByText('confirm-crop'));

        await waitFor(() => expect(onChange).toHaveBeenCalledWith({
            url: 'https://cdn.example/rahim.jpg',
            storageKey: 'retail/tenant-1/crm-photos/rahim',
        }));
        expect(mockUpload).toHaveBeenCalledWith(
            expect.objectContaining({ mimeType: 'image/jpeg', fileName: 'cropped.jpg' }),
        );
    });

    it('clears both fields when the photo is removed', async () => {
        const { onChange } = setup({
            url: 'https://cdn.example/rahim.jpg',
            storageKey: 'retail/tenant-1/crm-photos/rahim',
        });

        await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

        expect(onChange).toHaveBeenCalledWith({ url: '', storageKey: '' });
    });

    it('rejects a non-image before opening the cropper', async () => {
        const { onChange } = setup();

        await pickFile('x', 'application/pdf');

        expect(screen.queryByText('confirm-crop')).not.toBeInTheDocument();
        expect(mockToastError).toHaveBeenCalledWith(LABELS.notAnImage);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('rejects an oversized image before opening the cropper', async () => {
        const { onChange } = setup();

        await pickFile('x'.repeat(5 * 1024 * 1024 + 1));

        expect(screen.queryByText('confirm-crop')).not.toBeInTheDocument();
        expect(mockToastError).toHaveBeenCalledWith(LABELS.tooLarge);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('raises a toast and leaves the value alone when the upload fails', async () => {
        mockUpload.mockRejectedValue(new Error('storage is down'));
        const { onChange } = setup();

        await pickFile();
        await userEvent.click(await screen.findByText('confirm-crop'));

        await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('storage is down'));
        expect(onChange).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace=apps/frontend -- PhotoField`

Expected: FAIL — `Cannot find module './PhotoField'`.

- [ ] **Step 3: Write the component**

Create `apps/frontend/src/components/PhotoField.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import Avatar from './Avatar';
import AvatarCropModal from './AvatarCropModal';

/** Matches the hint text and the backend's own base64 ceiling. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type PhotoValue = { url: string; storageKey: string };

type PhotoFieldProps = {
    value: PhotoValue;
    /** Drives the initials fallback, so the field reads as this person's. */
    name: string;
    onChange: (value: PhotoValue) => void;
    labels: {
        label: string;
        add: string;
        change: string;
        remove: string;
        hint: string;
        uploading: string;
        uploadFailed: string;
        tooLarge: string;
        notAnImage: string;
        cropTitle: string;
        cropConfirm: string;
    };
    cancelLabel: string;
};

function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

/**
 * Pick, crop and upload a lead's or contact's photo.
 *
 * The upload happens on crop-confirm rather than on form save, because on a
 * create form there is no record yet to hang the file off. The record then
 * carries the URL and the storage key through the ordinary create/update
 * payload, which keeps saving one-phase.
 */
export default function PhotoField({
    value,
    name,
    onChange,
    labels,
    cancelLabel,
}: Readonly<PhotoFieldProps>) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);

    const handleFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // Reset immediately so picking the same file twice in a row still fires.
        event.target.value = '';
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            toast.error(labels.notAnImage);
            return;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            toast.error(labels.tooLarge);
            return;
        }

        setCropSrc(await readAsDataUrl(file));
    };

    const handleCropConfirm = async (file: File) => {
        setUploading(true);
        try {
            const imageBase64 = await readAsDataUrl(file);
            const result = await api.uploadCrmPhoto({
                imageBase64,
                mimeType: file.type,
                fileName: file.name,
            });
            onChange({ url: result.url, storageKey: result.storageKey });
        } catch (err: unknown) {
            // The rest of the form stays usable: a photo that will not upload
            // is not a reason to lose everything else the user has typed.
            toast.error(err instanceof Error ? err.message : labels.uploadFailed);
        } finally {
            setUploading(false);
            setCropSrc(null);
        }
    };

    return (
        <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
                <Avatar src={value.url} name={name} size="lg" />
                {uploading && (
                    <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </div>
                )}
            </div>

            <div className="space-y-1.5">
                <span className="block text-sm font-medium text-gray-700">{labels.label}</span>
                <div className="flex items-center gap-2">
                    <input
                        ref={inputRef}
                        data-testid="photo-field-input"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFilePick}
                    />
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={uploading}
                        className="min-h-touch inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-60"
                    >
                        <Camera className="w-4 h-4" />
                        {uploading ? labels.uploading : value.url ? labels.change : labels.add}
                    </button>
                    {value.url && !uploading && (
                        <button
                            type="button"
                            onClick={() => onChange({ url: '', storageKey: '' })}
                            className="min-h-touch rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:text-red-600 hover:bg-red-50"
                        >
                            {labels.remove}
                        </button>
                    )}
                </div>
                <p className="text-xs text-gray-400">{labels.hint}</p>
            </div>

            {cropSrc && (
                <AvatarCropModal
                    imageSrc={cropSrc}
                    open
                    title={labels.cropTitle}
                    confirmLabel={labels.cropConfirm}
                    cancelLabel={cancelLabel}
                    onClose={() => setCropSrc(null)}
                    onConfirm={handleCropConfirm}
                />
            )}
        </div>
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=apps/frontend -- PhotoField`

Expected: PASS — all 6 cases.

If the oversized-file case fails because jsdom reports `file.size` as 0, construct the file with an explicit blob part of the right length — `new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' })` — rather than weakening the assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/PhotoField.tsx apps/frontend/src/components/PhotoField.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add PhotoField picker

Pick, crop via the existing AvatarCropModal, and upload on confirm. Uploading
before save is what lets a create form carry a photo at all — there is no
record yet to attach one to. A failed upload toasts and leaves the rest of the
form usable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Contacts — form state and list column

**Files:**

- Modify: `apps/frontend/src/app/(app)/crm/contacts/contact-form-fields.tsx`
- Modify: `apps/frontend/src/app/(app)/crm/contacts/contact-form-fields.test.ts`
- Modify: `apps/frontend/src/app/(app)/crm/contacts/page.tsx`

**Interfaces:**

- Consumes: `PhotoField` + `PhotoValue` (Task 8); `Avatar` (Task 6); the `photo` i18n keys (Task 7); the contacts API changes (Task 4).
- Produces: `ContactFormState` gains `photo_url: string` and `photo_storage_key: string`, both flowing through `emptyContactForm`, `contactToFormState` and `contactFormToPayload`.

- [ ] **Step 1: Write the failing test**

Append to `apps/frontend/src/app/(app)/crm/contacts/contact-form-fields.test.ts`:

```typescript
describe('photo fields', () => {
    it('starts empty', () => {
        const form = emptyContactForm();
        expect(form.photo_url).toBe('');
        expect(form.photo_storage_key).toBe('');
    });

    it('reads both fields off a saved contact', () => {
        const form = contactToFormState({
            name: 'Rahim',
            photo_url: 'https://cdn.example/rahim.jpg',
            photo_storage_key: 'retail/tenant-1/crm-photos/rahim',
        });
        expect(form.photo_url).toBe('https://cdn.example/rahim.jpg');
        expect(form.photo_storage_key).toBe('retail/tenant-1/crm-photos/rahim');
    });

    it('treats a contact with no photo as empty strings, not "null"', () => {
        const form = contactToFormState({ name: 'Rahim', photo_url: null });
        expect(form.photo_url).toBe('');
        expect(form.photo_storage_key).toBe('');
    });

    it('sends both fields in the payload', () => {
        const payload = contactFormToPayload({
            ...emptyContactForm(),
            name: 'Rahim',
            photo_url: 'https://cdn.example/rahim.jpg',
            photo_storage_key: 'retail/tenant-1/crm-photos/rahim',
        });
        expect(payload.photo_url).toBe('https://cdn.example/rahim.jpg');
        expect(payload.photo_storage_key).toBe('retail/tenant-1/crm-photos/rahim');
    });

    it('sends blanks when the photo was removed, so the backend clears it', () => {
        const payload = contactFormToPayload({ ...emptyContactForm(), name: 'Rahim' });
        expect(payload.photo_url).toBe('');
        expect(payload.photo_storage_key).toBe('');
    });

    it('does not let a scanned card overwrite the photo fields', () => {
        const merged = applyScannedCard(emptyContactForm(), {
            name: 'Rahim',
            photo_url: 'https://evil.example/x.jpg',
        } as any);
        expect(merged.photo_url).toBe('');
    });
});
```

The last case needs `applyScannedCard` in the file's imports if it is not already there.

**Note on that last case:** `applyScannedCard` iterates `Object.keys(emptyContactForm())`, so adding photo keys to the state would let a scan write them. The step below excludes them explicitly.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace=apps/frontend -- contact-form-fields`

Expected: FAIL — `photo_url` is `undefined`.

- [ ] **Step 3: Extend the form state**

In `apps/frontend/src/app/(app)/crm/contacts/contact-form-fields.tsx`:

1. Add to `ContactFormState`:

```typescript
    photo_url: string;
    photo_storage_key: string;
```

2. Add to `emptyContactForm()`:

```typescript
    photo_url: '',
    photo_storage_key: '',
```

3. Add to `contactToFormState()`:

```typescript
        photo_url: String(contact.photo_url ?? ''),
        photo_storage_key: String(contact.photo_storage_key ?? ''),
```

4. Add to `contactFormToPayload()` (unconditionally, like every other field there — a blank must reach the backend for the photo to be clearable):

```typescript
        photo_url: form.photo_url,
        photo_storage_key: form.photo_storage_key,
```

5. Exclude the photo from the scanned-card merge. Change the loop in `applyScannedCard`:

```typescript
/** Fields a card scan may fill. The photo is not one: a scan produces a picture
 *  of a *card*, which is not what a profile photo is for, and it is kept as an
 *  attachment instead. */
const SCANNABLE_FIELDS = (Object.keys(emptyContactForm()) as (keyof ContactFormState)[]).filter(
    (key) => key !== 'photo_url' && key !== 'photo_storage_key',
);
```

and use `for (const key of SCANNABLE_FIELDS)` in place of the existing `for (const key of Object.keys(emptyContactForm()) as (keyof ContactFormState)[])`.

- [ ] **Step 4: Render `PhotoField` in the form**

In the same file, add the imports:

```typescript
import PhotoField from '@/components/PhotoField';
```

and add this as the **first child** of the `<div className="grid gap-3 sm:grid-cols-2">` in `ContactFormFields`, before the name `Field`:

```tsx
            <div className="sm:col-span-2">
                <PhotoField
                    value={{ url: form.photo_url, storageKey: form.photo_storage_key }}
                    name={form.name}
                    onChange={(photo) =>
                        onChange({ ...form, photo_url: photo.url, photo_storage_key: photo.storageKey })
                    }
                    labels={m.photo}
                    cancelLabel={t.common.cancel}
                />
            </div>
```

`t` is already destructured in this component as `const { t } = useI18n();` — confirm `t.common.cancel` exists (`grep -n "cancel:" apps/frontend/src/lib/localization/messages/en/core.ts`), and use whatever the existing cancel key is if it differs.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --workspace=apps/frontend -- contact-form-fields`

Expected: PASS — the six new cases and every pre-existing one.

- [ ] **Step 6: Render the avatar in the list**

In `apps/frontend/src/app/(app)/crm/contacts/page.tsx`:

1. Add the import:

```typescript
import Avatar from '@/components/Avatar';
```

2. Add `photo_url: string | null;` to the `Contact` interface.

3. Replace the `name` column's `cell` with:

```tsx
            cell: (info) => (
                <div className="flex items-center gap-2.5">
                    <Avatar src={info.row.original.photo_url} name={info.row.original.name} />
                    <Link
                        href={routes.crm.contactDetail(info.row.original.id)}
                        className="font-semibold text-gray-900 hover:text-primary"
                    >
                        {info.getValue()}
                    </Link>
                </div>
            ),
```

The column keeps its `name` accessor and id, so the server-side sort key is unchanged.

- [ ] **Step 7: Run the contacts page tests**

Run: `npm test --workspace=apps/frontend -- crm/contacts`

Expected: PASS — existing page and form tests still pass.

- [ ] **Step 8: Commit**

```bash
git add "apps/frontend/src/app/(app)/crm/contacts"
git commit -m "$(cat <<'EOF'
feat(crm): photo picker on the contact form and avatar in the list

The photo is excluded from the scanned-card merge: a scan produces a picture of
a card, which is not what a profile photo is for, and it is already kept as an
attachment.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Leads — form state and list column

**Files:**

- Modify: `apps/frontend/src/app/(app)/crm/leads/lead-form-fields.tsx`
- Create: `apps/frontend/src/app/(app)/crm/leads/lead-form-fields.test.ts`
- Modify: `apps/frontend/src/app/(app)/crm/leads/page.tsx`

**Interfaces:**

- Consumes: `PhotoField` (Task 8); `Avatar` (Task 6); the `photo` i18n keys (Task 7); the leads API changes (Task 5).
- Produces: `LeadFormState` gains `photo_url: string` and `photo_storage_key: string`, flowing through `emptyLeadForm`, `leadToFormState` and `leadFormToPayload`.

- [ ] **Step 1: Write the failing test**

`lead-form-fields.test.ts` does not exist yet — create `apps/frontend/src/app/(app)/crm/leads/lead-form-fields.test.ts`:

```typescript
import {
    emptyLeadForm,
    leadToFormState,
    leadFormToPayload,
} from './lead-form-fields';

describe('lead photo fields', () => {
    it('starts empty', () => {
        const form = emptyLeadForm();
        expect(form.photo_url).toBe('');
        expect(form.photo_storage_key).toBe('');
    });

    it('reads both fields off a saved lead', () => {
        const form = leadToFormState({
            name: 'Rahim',
            photo_url: 'https://cdn.example/rahim.jpg',
            photo_storage_key: 'retail/tenant-1/crm-photos/rahim',
        });
        expect(form.photo_url).toBe('https://cdn.example/rahim.jpg');
        expect(form.photo_storage_key).toBe('retail/tenant-1/crm-photos/rahim');
    });

    it('treats a lead with no photo as empty strings, not "null"', () => {
        const form = leadToFormState({ name: 'Rahim', photo_url: null });
        expect(form.photo_url).toBe('');
        expect(form.photo_storage_key).toBe('');
    });

    it('sends both fields in the payload', () => {
        const payload = leadFormToPayload({
            ...emptyLeadForm(),
            name: 'Rahim',
            photo_url: 'https://cdn.example/rahim.jpg',
            photo_storage_key: 'retail/tenant-1/crm-photos/rahim',
        });
        expect(payload.photo_url).toBe('https://cdn.example/rahim.jpg');
        expect(payload.photo_storage_key).toBe('retail/tenant-1/crm-photos/rahim');
    });

    it('sends blanks when the photo was removed, so the backend clears it', () => {
        const payload = leadFormToPayload({ ...emptyLeadForm(), name: 'Rahim' });
        expect(payload.photo_url).toBe('');
        expect(payload.photo_storage_key).toBe('');
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace=apps/frontend -- lead-form-fields`

Expected: FAIL — `photo_url` is `undefined`.

- [ ] **Step 3: Extend the form state**

In `apps/frontend/src/app/(app)/crm/leads/lead-form-fields.tsx`:

1. Add to `LeadFormState`:

```typescript
    photo_url: string;
    photo_storage_key: string;
```

2. Add to `emptyLeadForm()`:

```typescript
    photo_url: '',
    photo_storage_key: '',
```

3. Add to `leadToFormState()`:

```typescript
        photo_url: String(lead.photo_url ?? ''),
        photo_storage_key: String(lead.photo_storage_key ?? ''),
```

4. Add to `leadFormToPayload()`, beside the `payload.category` line and with the same reasoning — sent unconditionally so a cleared photo is clearable:

```typescript
    // Sent unconditionally for the same reason as `category`: an empty value is
    // meaningful ("no photo"), so omitting it would make removing one impossible.
    payload.photo_url = form.photo_url;
    payload.photo_storage_key = form.photo_storage_key;
```

- [ ] **Step 4: Render `PhotoField` in the form**

Add the import:

```typescript
import PhotoField from '@/components/PhotoField';
```

and add as the **first child** of the `<div className="grid gap-3 sm:grid-cols-2">` in `LeadFormFields`, before the name `Field`:

```tsx
            <div className="sm:col-span-2">
                <PhotoField
                    value={{ url: form.photo_url, storageKey: form.photo_storage_key }}
                    name={form.name}
                    onChange={(photo) =>
                        onChange({ ...form, photo_url: photo.url, photo_storage_key: photo.storageKey })
                    }
                    labels={m.photo}
                    cancelLabel={t.common.cancel}
                />
            </div>
```

`LeadFormFields` currently destructures only `const { t } = useI18n();` and derives `const m = t.crm.leads;` — both are already in scope.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --workspace=apps/frontend -- lead-form-fields`

Expected: PASS — all 5 cases.

- [ ] **Step 6: Render the avatar in the list**

In `apps/frontend/src/app/(app)/crm/leads/page.tsx`:

1. Add the import:

```typescript
import Avatar from '@/components/Avatar';
```

2. Add `photo_url: string | null;` to the `Lead` interface.

3. Replace the `name` column's `cell` with:

```tsx
            cell: (info) => (
                <div className="flex items-center gap-2.5">
                    <Avatar src={info.row.original.photo_url} name={info.row.original.name} />
                    <Link
                        href={routes.crm.leadDetail(info.row.original.id)}
                        className="font-semibold text-gray-900 hover:text-primary"
                    >
                        {info.getValue()}
                    </Link>
                </div>
            ),
```

- [ ] **Step 7: Run the leads tests and the frontend build**

Run: `npm test --workspace=apps/frontend -- crm/leads`
Expected: PASS.

Run: `npm run build --workspace=apps/frontend`
Expected: compiles with no type errors.

- [ ] **Step 8: Commit**

```bash
git add "apps/frontend/src/app/(app)/crm/leads"
git commit -m "$(cat <<'EOF'
feat(crm): photo picker on the lead form and avatar in the list

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: End-to-end verification and TODO.md

**Files:**

- Modify: `TODO.md`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing further.

- [ ] **Step 1: Run the full test suites**

Run: `npm test --workspace=apps/backend`
Run: `npm test --workspace=apps/frontend`

Expected: no new failures. The four `test/*.spec.ts` backend integration suites are known-broken for reasons unrelated to this work (see the Infrastructure / Ops section of TODO.md); everything else must pass. Paste the actual summary lines into your report — do not claim a pass you have not seen.

- [ ] **Step 2: Verify in the running app**

Start the stack however this repo does locally (check `package.json` at the root for a `dev` script), log in, and check each of these by hand:

1. **Contacts → New Contact** — the photo picker appears above the name field. Pick an image; the crop modal opens; confirm; the avatar fills in. Save. The contact opens with its photo.
2. **Contacts list** — the new contact's photo shows in the first column beside the name. A contact without one shows blue initials.
3. **Edit the contact** — change the photo to a different image, save, reload. The new photo shows.
4. **Remove the photo** — click Remove, save, reload. The initials fallback shows.
5. **Repeat 1–4 for Leads.**
6. **Mobile at 360px** — the name column still fits and the body does not scroll horizontally; the photo buttons are comfortably tappable.
7. **Sort by Name** in both lists — still works (the avatar sits inside the same column).

If Cloudinary is not configured locally, uploads will fail with "File storage is not configured" — that is the correct behaviour. Verify the form stays usable and the record still saves without a photo, then check the rest against an environment that has credentials.

- [ ] **Step 3: Update TODO.md**

In `TODO.md`, under `### CRM Module (Epic 70–74)`, change the profile-photos line from `- [ ]` to `- [x]`, then move it to the `## COMPLETED` section at the bottom in this form:

```markdown
- [x] Profile photos on Leads and Contacts — `photo_url` + `photo_storage_key` on both models, `POST /crm/photos` returning Cloudinary's public_id so replaced photos are reclaimed rather than stranded, `PhotoField` picker in both create/edit forms reusing `AvatarCropModal`, avatar inline in the first column of both lists (`docs/superpowers/specs/2026-08-11-crm-lead-contact-photos-design.md`) — done 2026-08-11
```

- [ ] **Step 4: Add the follow-up that this work surfaced**

Still in `TODO.md`, add to the `### CRM Module (Epic 70–74)` section:

```markdown
- [ ] CRM photos uploaded from a create form that is then abandoned are orphaned in Cloudinary — `POST /crm/photos` stores the file before the lead/contact exists, which is what keeps the save one-phase (see the 2026-08-11 photos spec). Accepted at the time as a rare, bounded cost against the alternative of a two-phase save. A reconciliation script listing `retail/<tenant>/crm-photos` and deleting anything matched by neither `Lead.photo_storage_key` nor `CrmContact.photo_storage_key` would reclaim them if the folder ever grows enough to matter.
```

- [ ] **Step 5: Commit**

```bash
git add TODO.md
git commit -m "$(cat <<'EOF'
docs(todo): record the CRM lead/contact photos work

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Push**

```bash
git push origin dev
```

Deployment is a separate, explicit step (merge `dev` → `main` via PR, then SSH and run `./scripts/deploy.sh main`). Do not deploy without being asked.

---

## Notes for the implementer

**Where the guardrail actually is.** The single most important line in this change is `assertTenantPhotoKey`. `photo_storage_key` is a client-supplied string that ends up as an argument to `cloudinary.destroy`. Without the prefix check, tenant A sets a lead's photo key to tenant B's `public_id`, changes the photo, and B's asset is deleted. Task 3 tests this directly; do not weaken those tests to make an implementation pass.

**Why `''` is not `undefined`.** Throughout the CRM DTOs, an omitted field means "leave it alone" and an empty string means "clear it". The contacts DTO file has a long comment on `skipWhenBlank` explaining why. The photo fields follow the same rule — that is what makes Remove work.

**Delete after the row, never before.** Both services write the row first and delete the old Cloudinary asset second. A failed delete then leaves a stray file; the other order leaves a row pointing at nothing. This matches the existing `removeAttachment`.
