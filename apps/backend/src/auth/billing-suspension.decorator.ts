import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_SUSPENDED_KEY = 'allow_when_suspended';

/**
 * Lets a write survive a billing suspension.
 *
 * Reserve it for routes that are part of getting *out* of suspension, or that
 * would strand the user if blocked — not for "this one is harmless". The whole
 * point of the freeze is that business data stops changing while the balance is
 * unpaid, so every exemption is a hole in the lever.
 */
export const AllowWhenSuspended = () => SetMetadata(ALLOW_WHEN_SUSPENDED_KEY, true);
