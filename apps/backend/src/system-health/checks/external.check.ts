import { Injectable, Logger } from '@nestjs/common';
import type { CheckResult, DependencyState } from '@retail-saas/shared-types';

/** Per-probe timeout. Kept short so a slow provider can't stall the report. */
const DEP_TIMEOUT_MS = parseInt(process.env.HEALTH_DEP_TIMEOUT_MS ?? '2000', 10);

interface ProviderDescriptor {
    name: string;
    label: string;
    /** URL to probe for reachability. */
    url: string;
    /** Whether the provider is configured in this environment. */
    enabled: boolean;
}

/**
 * Reachability checks for the third-party providers the platform depends on.
 * These are connectivity probes only — any HTTP response (even 4xx/5xx) means
 * the host is reachable; only a network error or timeout counts as `down`.
 * Every external provider is non-critical: if one is down the system is
 * `degraded`, not `down`.
 */
@Injectable()
export class ExternalCheck {
    private readonly logger = new Logger(ExternalCheck.name);

    async run(): Promise<CheckResult[]> {
        const providers = this.describeProviders();
        return Promise.all(providers.map((p) => this.probe(p)));
    }

    private describeProviders(): ProviderDescriptor[] {
        const env = process.env;
        const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;

        return [
            {
                name: 'sslcommerz',
                label: 'SSLCommerz',
                url: env.SSL_WIRELESS_API_URL ?? 'https://securepay.sslcommerz.com',
                enabled: !!env.SSL_WIRELESS_API_URL,
            },
            {
                name: 'bkash',
                label: 'bKash',
                url: env.BKASH_API_URL ?? 'https://api.bkash.com',
                enabled: !!env.BKASH_APP_KEY,
            },
            {
                name: 'nagad',
                label: 'Nagad',
                url: env.NAGAD_API_URL ?? 'https://api.nagad.com.bd',
                enabled: !!env.NAGAD_API_KEY,
            },
            {
                name: 'bulksmsbd',
                label: 'BulkSMSBD',
                url: env.SMS_API_URL ?? 'http://bulksmsbd.net/api/smsapi',
                enabled: !!env.SMS_API_KEY,
            },
            {
                name: 'resend',
                label: 'Resend (email)',
                url: 'https://api.resend.com',
                enabled: !!env.RESEND_API_KEY,
            },
            {
                name: 'cloudinary',
                label: 'Cloudinary',
                url: 'https://api.cloudinary.com',
                enabled: !!env.CLOUDINARY_API_KEY,
            },
            {
                name: 'supabase',
                label: 'Supabase',
                url: supabaseUrl ?? '',
                enabled: !!supabaseUrl,
            },
        ];
    }

    private async probe(provider: ProviderDescriptor): Promise<CheckResult> {
        const base: Pick<CheckResult, 'name' | 'label' | 'critical'> = {
            name: provider.name,
            label: provider.label,
            critical: false,
        };

        if (!provider.enabled || !provider.url) {
            return { ...base, state: 'disabled', message: 'Not configured' };
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEP_TIMEOUT_MS);
        const start = Date.now();

        try {
            // HEAD with manual redirect handling: we only care that the host
            // answers, not what it returns. A 4xx/5xx still proves reachability.
            await fetch(provider.url, {
                method: 'HEAD',
                redirect: 'manual',
                signal: controller.signal,
            });
            return { ...base, state: 'ok', latency_ms: Date.now() - start };
        } catch (err) {
            const timedOut = err instanceof Error && err.name === 'AbortError';
            const message = timedOut ? `No response within ${DEP_TIMEOUT_MS}ms` : 'Unreachable';
            this.logger.warn(`Health probe for ${provider.label} failed: ${message}`);
            const state: DependencyState = 'down';
            return { ...base, state, latency_ms: Date.now() - start, message };
        } finally {
            clearTimeout(timer);
        }
    }
}
