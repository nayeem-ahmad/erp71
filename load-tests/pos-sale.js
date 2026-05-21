/**
 * k6 load test: POS sale endpoint
 *
 * Simulates peak load: multiple concurrent cashiers across multiple tenants.
 *
 * Run:  k6 run load-tests/pos-sale.js
 * Docs: https://k6.io/docs/
 *
 * Environment variables:
 *   BASE_URL          — backend base URL (default: http://localhost:4000)
 *   AUTH_TOKEN        — JWT for a tenant with cashier role
 *   TENANT_ID         — tenant to target
 *   PRODUCT_ID        — a valid product ID in that tenant
 *   STORE_ID          — a valid store ID
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const saleLatency = new Trend('sale_latency_ms');

const SCENARIO = __ENV.SCENARIO || 'peak_load';

export const options = {
    scenarios: SCENARIO === 'multi_tenant' ? {
        multi_tenant: {
            executor: 'ramping-vus',
            exec: 'multiTenantSetup',
            startVUs: 1,
            stages: [
                { duration: '1m', target: 50 },
                { duration: '3m', target: 50 },
                { duration: '30s', target: 0 },
            ],
            gracefulRampDown: '30s',
        },
    } : {
        // Ramp up to 50 concurrent cashiers over 1 minute, hold for 3 minutes, ramp down
        peak_load: {
            executor: 'ramping-vus',
            startVUs: 1,
            stages: [
                { duration: '1m', target: 50 },   // ramp up: 50 cashiers
                { duration: '3m', target: 50 },   // peak: hold at 50
                { duration: '30s', target: 0 },    // ramp down
            ],
            gracefulRampDown: '30s',
        },
    },

    thresholds: {
        // 95% of sales must complete in under 2 seconds
        sale_latency_ms: ['p(95)<2000'],
        // Error rate must stay below 1%
        errors: ['rate<0.01'],
        // HTTP failure rate
        http_req_failed: ['rate<0.01'],
    },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'replace-with-valid-jwt';
const TENANT_ID = __ENV.TENANT_ID || 'replace-with-tenant-id';
const PRODUCT_ID = __ENV.PRODUCT_ID || 'replace-with-product-id';
const STORE_ID = __ENV.STORE_ID || 'replace-with-store-id';

const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${AUTH_TOKEN}`,
    'x-tenant-id': TENANT_ID,
};

export default function () {
    const salePayload = JSON.stringify({
        storeId: STORE_ID,
        totalAmount: 100,
        amountPaid: 100,
        items: [
            {
                productId: PRODUCT_ID,
                quantity: 1,
                priceAtSale: 100,
            },
        ],
        payments: [{ paymentMethod: 'CASH', amount: 100 }],
    });

    const start = Date.now();
    const res = http.post(`${BASE_URL}/api/v1/sales`, salePayload, { headers });
    const elapsed = Date.now() - start;

    saleLatency.add(elapsed);

    const success = check(res, {
        'status is 201': (r) => r.status === 201,
        'response has sale id': (r) => {
            try {
                const body = JSON.parse(r.body);
                return !!(body?.data?.id || body?.id);
            } catch {
                return false;
            }
        },
        'latency under 2s': () => elapsed < 2000,
    });

    errorRate.add(!success);

    // Simulate cashier think time between transactions (1–3 seconds)
    sleep(Math.random() * 2 + 1);
}

/**
 * Multi-tenant scenario: simulates load across 5 tenants.
 * Each VU picks a tenant based on its ID.
 *
 * Usage: k6 run load-tests/pos-sale.js -e SCENARIO=multi_tenant
 */
export function multiTenantSetup() {
    const tenants = ((__ENV.TENANT_IDS || TENANT_ID) + '').split(',');
    const vuTenant = tenants[(__VU - 1) % tenants.length];

    const salePayload = JSON.stringify({
        storeId: STORE_ID,
        totalAmount: 50,
        amountPaid: 50,
        items: [{ productId: PRODUCT_ID, quantity: 1, priceAtSale: 50 }],
    });

    const tenantHeaders = { ...headers, 'x-tenant-id': vuTenant };
    const res = http.post(`${BASE_URL}/api/v1/sales`, salePayload, { headers: tenantHeaders });

    check(res, { 'status 201': (r) => r.status === 201 });
    errorRate.add(res.status !== 201);
    sleep(1);
}
