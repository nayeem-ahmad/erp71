import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CronExpression } from '@nestjs/schedule';
import { JOB_NAMES, JOB_REGISTRY, JOB_TIME_ZONE, type JobName } from './job-names';

/**
 * Reads the `@Cron` decorators from the source, because `@nestjs/schedule`
 * keeps its metadata keys private and importing every scheduled service would
 * drag half the app in for a check about strings.
 *
 * Two things it holds in place:
 *  - every `@Cron` names Bangladesh time. One without a zone runs in the
 *    server's — UTC on the VPS — six hours off what it says.
 *  - `JOB_REGISTRY`, which the system-health dashboard shows and judges
 *    "overdue" against, matches what the decorators actually schedule.
 */
interface ScheduledMethod {
    file: string;
    expression: string;
    options: string;
    job: JobName | null;
}

const SRC = join(__dirname, '..', '..');

function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            yield* walk(full);
        } else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) {
            yield full;
        }
    }
}

function resolveExpression(raw: string): string {
    const literal = /^'([^']+)'$/.exec(raw);
    if (literal) return literal[1];
    const named = /^CronExpression\.(\w+)$/.exec(raw);
    if (named) return CronExpression[named[1] as keyof typeof CronExpression];
    throw new Error(`Unreadable @Cron expression: ${raw}`);
}

function scheduledMethods(): ScheduledMethod[] {
    const found: ScheduledMethod[] = [];
    for (const file of walk(SRC)) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(/@Cron\(\s*([^,)]+?)\s*(?:,\s*(\{[^}]*\}))?\s*\)/g)) {
            // The decorated method runs to the next line closing a class member.
            const rest = source.slice(match.index! + match[0].length);
            const body = rest.slice(0, rest.search(/^ {4}\}/m));
            const job = /JOB_NAMES\.([A-Z_]+)/.exec(body)?.[1] as keyof typeof JOB_NAMES | undefined;
            found.push({
                file: file.slice(SRC.length + 1),
                expression: resolveExpression(match[1]),
                options: match[2] ?? '',
                job: job ? JOB_NAMES[job] : null,
            });
        }
    }
    return found;
}

/** `m h` of a daily expression, as minutes past midnight. */
function minuteOfDay(expression: string): number {
    const [minute, hour] = expression.split(' ');
    return Number(hour) * 60 + Number(minute);
}

const scheduleOf = (job: JobName) => JOB_REGISTRY.find((def) => def.name === job)!.schedule;

describe('scheduled jobs', () => {
    const methods = scheduledMethods();

    it('finds every @Cron in the backend', () => {
        // 19 tracked jobs, plus external sync, the platform ledger sync and the
        // two blog publishers. A new one should land in the table in job-names.ts.
        expect(methods).toHaveLength(23);
    });

    it('runs every @Cron on Bangladesh time', () => {
        expect(JOB_TIME_ZONE).toBe('Asia/Dhaka');
        const withoutZone = methods
            .filter((m) => !m.options.includes(`timeZone: '${JOB_TIME_ZONE}'`))
            .map((m) => `${m.file}: '${m.expression}'`);
        expect(withoutZone).toEqual([]);
    });

    it('keeps the dashboard registry in step with the decorators', () => {
        const tracked = methods.filter((m) => m.job !== null);
        expect(tracked.map((m) => m.job).sort()).toEqual(JOB_REGISTRY.map((def) => def.name).sort());
        for (const method of tracked) {
            expect({ job: method.job, schedule: method.expression }).toEqual({
                job: method.job,
                schedule: scheduleOf(method.job!),
            });
        }
    });

    it('puts the heavy batch jobs between 01:00 and 05:00', () => {
        const batch = [
            JOB_NAMES.NOTIFICATIONS_PURGE,
            JOB_NAMES.BILLING_RETRY,
            JOB_NAMES.CUSTOMER_SEGMENTS,
            JOB_NAMES.BILLING_DUNNING,
            JOB_NAMES.CRM_REORDER_FOLLOWUPS,
            JOB_NAMES.BILLING_PERIOD_FEES,
        ].map(scheduleOf);
        const untracked = methods
            .filter((m) => /external-sync\.scheduler|platform-accounting\.service/.test(m.file))
            .map((m) => m.expression);
        expect(untracked).toHaveLength(2);

        for (const expression of [...batch, ...untracked]) {
            expect(expression).toMatch(/^\d+ \d+ \* \* \*$/);
            expect(minuteOfDay(expression)).toBeGreaterThanOrEqual(60);
            expect(minuteOfDay(expression)).toBeLessThanOrEqual(5 * 60);
        }
    });

    it('keeps the billing chain in order, an hour apart, with the ledger sync after it', () => {
        const retry = minuteOfDay(scheduleOf(JOB_NAMES.BILLING_RETRY));
        const dunning = minuteOfDay(scheduleOf(JOB_NAMES.BILLING_DUNNING));
        const fees = minuteOfDay(scheduleOf(JOB_NAMES.BILLING_PERIOD_FEES));
        const ledgerSync = minuteOfDay(
            methods.find((m) => m.file.includes('platform-accounting.service'))!.expression,
        );

        expect(dunning - retry).toBe(60);
        expect(fees - dunning).toBe(60);
        expect(ledgerSync - fees).toBe(60);
    });

    it('fires the reminders people see at the same instant as before, now said in local time', () => {
        // The UTC expressions these ran on before they named a zone. BDT is
        // UTC+6 all year, and none of these crosses midnight.
        const before: Partial<Record<JobName, string>> = {
            [JOB_NAMES.NOTIFICATIONS_LOW_STOCK]: '0 7 * * *',
            [JOB_NAMES.NOTIFICATIONS_WEEKLY]: '0 7 * * 1',
            [JOB_NAMES.NOTIFICATIONS_MONTHLY]: '0 7 1 * *',
            [JOB_NAMES.NOTIFICATIONS_EXPIRY_WARNINGS]: '0 8 * * *',
            [JOB_NAMES.CRM_BIRTHDAY_FOLLOWUPS]: '0 8 * * *',
            [JOB_NAMES.IMPORTS_LC_EXPIRY]: '0 7 * * *',
            [JOB_NAMES.ACCOUNTING_RECURRING_VOUCHERS]: '0 6 * * *',
        };
        for (const [job, utc] of Object.entries(before) as [JobName, string][]) {
            const [minute, hour, ...rest] = utc.split(' ');
            expect({ job, schedule: scheduleOf(job) }).toEqual({
                job,
                schedule: [minute, String(Number(hour) + 6), ...rest].join(' '),
            });
        }
    });
});
