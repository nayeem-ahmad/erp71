import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TenantTimezoneService } from '../database/tenant-timezone.service';
import { startOfZonedToday } from '../common/tenant-time.util';

/** More than this many pushes a day and the rest wait in the bell. */
export const DAILY_PUSH_CAP = 30;

/** The same alert about the same thing inside this window is one alert. */
export const COLLAPSE_WINDOW_MS = 10 * 60 * 1000;

/** Quiet hours for someone who never set their own: 22:00–08:00 shop time. */
export const DEFAULT_QUIET = { from: 22 * 60, to: 8 * 60 };

export type PushDecision = 'push' | 'hold' | 'skip';

/** Whether [minute] (after midnight) falls in a window that may wrap midnight. */
export function inQuietWindow(minute: number, from: number, to: number): boolean {
    if (from === to) return false;
    return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** Minutes after midnight of [now], as a clock in [timeZone] reads. */
export function minuteOfDay(now: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now);
    const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return read('hour') * 60 + read('minute');
}

/**
 * What reaches a phone, decided once for every notification the app writes.
 *
 * The bell keeps everything; this only governs the push on top of it. A shop
 * that sends two hundred "low stock" pushes on its first morning gets the app
 * uninstalled, and the alerts that matter go with it.
 */
@Injectable()
export class AlertPolicy {
    constructor(
        private readonly db: DatabaseService,
        private readonly timezones: TenantTimezoneService,
    ) {}

    /** A notification of the same type and key for this person, written just now. */
    recentDuplicate(tenantId: string, userId: string, type: string, dedupeKey: string, now = new Date()) {
        return this.db.notification.findFirst({
            where: {
                tenant_id: tenantId,
                user_id: userId,
                type,
                dedupe_key: dedupeKey,
                created_at: { gte: new Date(now.getTime() - COLLAPSE_WINDOW_MS) },
            },
        });
    }

    async decide(tenantId: string, userId: string, type: string, now = new Date()): Promise<PushDecision> {
        const preference = await this.db.userAlertPreference.findUnique({
            where: { user_id_tenant_id: { user_id: userId, tenant_id: tenantId } },
        });
        if (preference?.muted_types.includes(type)) return 'skip';

        const timeZone = await this.timezones.for(tenantId);
        if (await this.isQuiet(preference, timeZone, now)) return 'hold';

        const pushedToday = await this.db.notification.count({
            where: { user_id: userId, pushed_at: { gte: startOfZonedToday(timeZone, now) } },
        });
        return pushedToday >= DAILY_PUSH_CAP ? 'skip' : 'push';
    }

    /** Whether this person's quiet hours are on now, in their workspace's time. */
    async isQuietFor(tenantId: string, userId: string, now = new Date()): Promise<boolean> {
        const preference = await this.db.userAlertPreference.findUnique({
            where: { user_id_tenant_id: { user_id: userId, tenant_id: tenantId } },
        });
        return this.isQuiet(preference, await this.timezones.for(tenantId), now);
    }

    private async isQuiet(
        preference: { quiet_enabled: boolean; quiet_from: number; quiet_to: number } | null,
        timeZone: string,
        now: Date,
    ): Promise<boolean> {
        const window = preference
            ? preference.quiet_enabled
                ? { from: preference.quiet_from, to: preference.quiet_to }
                : null
            : DEFAULT_QUIET;
        return window !== null && inQuietWindow(minuteOfDay(now, timeZone), window.from, window.to);
    }
}
