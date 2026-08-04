-- Project Management, Phase 3D + 3K — attachment storage keys and card covers.
-- Scope: docs/projects/project-management-phase-3.md
--
-- Additive.
--
-- `storage_key` closes the leak logged in TODO.md: `AssetsService.uploadFile()`
-- returned only a URL, which cannot be turned back into a Cloudinary
-- `public_id`, so an attachment row could be deleted while the file stayed —
-- billed indefinitely. Nothing has ever written a project attachment, so there
-- are no existing rows to reconcile here; `VoucherAttachment` still has the
-- original problem and is tracked separately.

ALTER TABLE "project_attachments" ADD COLUMN "storage_key" TEXT;

ALTER TABLE "project_attachments"
    ADD CONSTRAINT "project_attachments_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_tasks" ADD COLUMN "cover_color" "ProjectLabelColor";
