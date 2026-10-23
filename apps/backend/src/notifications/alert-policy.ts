import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_ALERT_PREFS, type AlertPartial, type AlertPrefs } from '@erp71/shared-types';
import { PreferencesService } from '../preferences/preferences.service';
import { DatabaseService } from '../database/database.service';
import { TenantTimezoneService } from '../database/tenant-timezone.service';
import { startOfZonedToday } from '../common/tenant-time.util';

const alertLogger = new Logger('AlertPolicy');

/** More than this many pushes a day and the rest wait in the bell. */
export const DAILY_PUSH_CAP = 30;

/** The same alert about the same thing inside this window is one alert. */
export const COLLAPSE_WINDOW_MS = 10 * 60 * 1000;

/** Quiet hours for someone who never set their own: 22:00–08:00 shop time. */
export const DEFAULT_QUIET = { from: DEFAULT_ALERT_PREFS.quiet.from, to: DEFAULT_ALERT_PREFS.quiet.to };

/** The member's stored alert row, as the database holds it. */
export interface AlertRow {
    muted_types: string[];
    quiet_enabled: boolean;
    quiet_from: number;
    quiet_to: number;
}

/**
 * What a member's alerts resolve to: their own row if they have one (it is a
 * whole answer), else the profile's alerts over the built-ins (`mutedTypes`
 * replaced whole, `quiet` field by field), else the built-ins.
 */
export function resolveAlertPrefs(row: AlertRow | null, profile?: AlertPartial): AlertPrefs {
    if (row) {
        return {
            mutedTypes: row.muted_types,
            quiet: { enabled: row.quiet_enabled, from: row.quiet_from, to: row.quiet_to },
        };
    }
    return {
        mutedTypes: [...(profile?.mutedTypes ?? DEFAULT_ALERT_PREFS.mutedTypes)],
        quiet: { ...DEFAULT_ALERT_PREFS.quiet, ...profile?.quiet },
    };
}

/**
 * The alerts layer of the member's profile, or nothing. A profile that cannot be
 * read must not break a push or the settings screen, so this falls back to the
 * built-ins, but it says so: otherwise a transient error silently turns a muted
 * type into a push and nothing records why. The one place that swallows and logs.
 */
export async function profileAlertsFor(
    preferences: Pick<PreferencesService, 'profileFor'>,
    tenantId: string,
    userId: string,
): Promise<AlertPartial | undefined> {
    try {
        return (await preferences.profileFor(tenantId, userId))?.prefs.sections.alerts;
    } catch (error) {
        alertLogger.warn(
            `Could not read the preference profile for user ${userId} in tenant ${tenantId}; using built-in alert settings: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
    }
}

/**
 * Resolved alerts by `tenantId:userId` for the length of one dispatch. A caller
 * that decides for many people at once passes one in so each person's row and
 * profile are read once; without it every call reads fresh, so a profile edit
 * is never hidden behind a long-lived cache.
 */
export type AlertPrefsCache = Map<string, Promise<AlertPrefs>>;

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
        private readonly preferences: PreferencesService,
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

    async decide(
        tenantId: string,
        userId: string,
        type: string,
        now = new Date(),
        cache?: AlertPrefsCache,
    ): Promise<PushDecision> {
        const alerts = await this.alertsFor(tenantId, userId, cache);
        if (alerts.mutedTypes.includes(type)) return 'skip';

        const timeZone = await this.timezones.for(tenantId);
        if (this.isQuiet(alerts, timeZone, now)) return 'hold';

        const pushedToday = await this.db.notification.count({
            where: { user_id: userId, pushed_at: { gte: startOfZonedToday(timeZone, now) } },
        });
        return pushedToday >= DAILY_PUSH_CAP ? 'skip' : 'push';
    }

    /** Whether this person's quiet hours are on now, in their workspace's time. */
    async isQuietFor(tenantId: string, userId: string, now = new Date(), cache?: AlertPrefsCache): Promise<boolean> {
        const alerts = await this.alertsFor(tenantId, userId, cache);
        return this.isQuiet(alerts, await this.timezones.for(tenantId), now);
    }

    private alertsFor(tenantId: string, userId: string, cache?: AlertPrefsCache): Promise<AlertPrefs> {
        const key = `${tenantId}:${userId}`;
        const known = cache?.get(key);
        if (known) return known;
        const resolved = this.loadAlerts(tenantId, userId);
        cache?.set(key, resolved);
        return resolved;
    }

    /** The member's row, else their profile's alerts, else the built-ins. A profile that cannot be read is no profile. */
    private async loadAlerts(tenantId: string, userId: string): Promise<AlertPrefs> {
        const row = await this.db.userAlertPreference.findUnique({
            where: { user_id_tenant_id: { user_id: userId, tenant_id: tenantId } },
        });
        if (row) return resolveAlertPrefs(row);
        return resolveAlertPrefs(null, await profileAlertsFor(this.preferences, tenantId, userId));
    }

    private isQuiet(alerts: AlertPrefs, timeZone: string, now: Date): boolean {
        const { enabled, from, to } = alerts.quiet;
        return enabled && inQuietWindow(minuteOfDay(now, timeZone), from, to);
    }
}
