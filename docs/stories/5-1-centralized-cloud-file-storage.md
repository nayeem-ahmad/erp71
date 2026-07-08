# Story 5.1: Centralized Cloud File Storage

Status: drafted

## Story

As a system architect,
I want tenant-aware storage buckets and a reusable upload flow,
so that product images, store branding, and private business documents can be handled consistently across modules.

## Acceptance Criteria

1. The storage strategy defines separate public, private, and temporary upload buckets or equivalent logical paths. [ ]
2. Uploads are tenant-scoped and cannot collide across tenants. [ ]
3. The backend assets service supports bucket or path selection, file validation, and consistent error handling. [ ]
4. The frontend has a reusable upload component or helper with progress, file-type checks, and size checks. [ ]
5. Existing upload use cases can consume the new storage contract without module-specific upload code duplication. [ ]
6. Automated tests cover file validation, tenant scoping, and upload-path generation. [ ]

## Tasks / Subtasks

- [ ] Task 1: Storage contract and backend service update
  - [ ] Refactor the current assets service to support multiple buckets or path namespaces.
  - [ ] Add explicit file validation and tenant-safe path generation.
  - [ ] Likely file targets: `apps/backend/src/assets/assets.service.ts`, `apps/backend/src/assets/assets.controller.ts`

- [ ] Task 2: Shared upload helper
  - [ ] Create a frontend upload helper or component that wraps the existing `/assets/upload` API.
  - [ ] Support progress, accepted MIME types, and user-facing validation errors.
  - [ ] Likely file targets: `apps/frontend/src/lib/api.ts`, `apps/frontend/src/components/*`

- [ ] Task 3: Storage configuration docs
  - [ ] Document required bucket layout and environment configuration.
  - [ ] Likely file targets: `.env.example`, `docs/architecture/external-apis.md`

- [ ] Task 4: Tests
  - [ ] Add backend tests for validation and path generation.
  - [ ] Add frontend tests for upload helper validation.
  - [ ] Likely file targets: `apps/backend/src/assets/*.spec.ts`, `apps/frontend/src/components/*.test.tsx`

## Dev Notes

- The repo already has an assets module backed by Supabase storage. Build on that instead of adding a second upload path.
- Keep bucket or path decisions backend-owned so tenant context and access rules remain server-side.
- Public URLs should only be returned for assets intended to be public.

## Dependencies

- Depends on tenant context from Epic 03.
- Supports Stories 5.2, 5.3, 80.1, and later HR/manufacturing document uploads.

### References

- [Source: docs/prd/epic-05-core-platform-services.md]
- [Source: apps/backend/src/assets/assets.service.ts]
- [Source: apps/backend/src/assets/assets.controller.ts]
