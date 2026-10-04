import { api } from '@/lib/api';
import { directUpload, withServerFallback } from './direct-upload';

/**
 * Upload and save the signed-in user's avatar, returning the stored URL.
 *
 * Straight to Cloudinary, then `PATCH /auth/me/avatar` with only the result —
 * which the API checks is in this user's own avatar folder before saving. If
 * any of that fails, the same route with the file as multipart, as before.
 *
 * Shared by the profile page and `AvatarContext` so the two cannot drift.
 */
export async function uploadProfileAvatar(file: File): Promise<string | null> {
    const result: { avatarUrl?: string } | null = await withServerFallback(
        async () => api.setProfileAvatarFromUpload(await directUpload(file, 'avatar')),
        () => {
            const formData = new FormData();
            formData.append('avatar', file);
            return api.updateProfileAvatar(formData);
        },
    );
    return result?.avatarUrl ?? null;
}
