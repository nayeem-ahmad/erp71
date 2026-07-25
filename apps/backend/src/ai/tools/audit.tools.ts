import { StorePermission } from '@erp71/shared-types';
import { ANOMALY_TYPES, type AnomalySensitivity, type AnomalyType } from '../anomaly-detection.service';
import { DATE_RANGE_PROPS, money, page, PAGING_PROPS, resolveStoreId, STORE_PROP, type ChatTool } from './types';

/**
 * The one tool that looks for problems rather than answering a question.
 *
 * Every other tool in this directory reports what happened. This one compares
 * each transaction against what normally happens and returns only the ones that
 * do not fit — sold below cost, priced far off the product's own median, a
 * quantity nobody has ever bought before, the same invoice twice.
 *
 * The detection is entirely in `AnomalyDetectionService`, in SQL. The model
 * gets a ranked list with the arithmetic already done and its job is to explain
 * and prioritise, which is the half it is good at. Handing it raw transactions
 * and asking it to spot outliers produces confident nonsense.
 */
export const AUDIT_TOOLS: ChatTool[] = [
    {
        name: 'transaction_anomalies',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail', 'inventory'],
        description:
            'Scans individual sales, purchases and returns for transactions that do not fit the pattern, and returns ' +
            'them ranked by the taka at stake. Detects: sold below its own recorded cost, sold at zero, unit price far ' +
            'off that product\'s usual price, unit cost far off what that product usually costs, bought for more than ' +
            'the shelf price, a line quantity far above normal, the same invoice or supplier bill twice on one day, ' +
            'sales dated far from when they were entered, and refunds exceeding the invoice they are against. ' +
            'Use for "is anything wrong", "check for mistakes or fraud", "unusual transactions", "did anyone sell ' +
            'below cost", "are we being overcharged", "duplicate invoices". Each flag states what was observed, what ' +
            'it was compared against, and how many past transactions the comparison came from — quote those, and ' +
            'never call a flag proven wrongdoing. Most are data-entry errors.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                types: {
                    type: 'array',
                    items: { type: 'string', enum: ANOMALY_TYPES },
                    description:
                        'Restrict the scan to these checks. Omit to run all of them, which is the right default ' +
                        'for an open-ended "is anything wrong" question.',
                },
                sensitivity: {
                    type: 'string',
                    enum: ['high', 'normal', 'low'],
                    description:
                        'How far from normal something must be before it is flagged. "high" catches more and is ' +
                        'noisier, "low" surfaces only the egregious. Defaults to normal. Raise it only if a normal ' +
                        'scan came back empty and the user is sure something is wrong.',
                },
                minImpact: {
                    type: 'number',
                    description:
                        'Ignore flags worth less than this many taka. Use when the user only cares about material ' +
                        'amounts. Defaults to ৳100 at normal sensitivity.',
                },
                baselineDays: {
                    type: 'number',
                    description:
                        'Days of history the "usual" price, cost and quantity are measured over, ending at `to`. ' +
                        'Defaults to 90. Shorten it for a business whose prices genuinely moved recently.',
                },
                ...PAGING_PROPS,
            },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const types = Array.isArray(args.types)
                ? (args.types.filter((type: unknown): type is AnomalyType =>
                      ANOMALY_TYPES.includes(type as AnomalyType),
                  ) as AnomalyType[])
                : undefined;

            const result = await deps.anomalies.scan(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
                types: types?.length ? types : undefined,
                sensitivity: asSensitivity(args.sensitivity),
                minImpact: Number.isFinite(Number(args.minImpact)) ? Number(args.minImpact) : undefined,
                baselineDays: Number.isFinite(Number(args.baselineDays)) ? Number(args.baselineDays) : undefined,
            });

            const paged = page(result.anomalies, args);

            return {
                ...(note ? { note } : {}),
                period: result.period,
                baselinePeriod: result.baselinePeriod,
                sensitivity: result.sensitivity,
                thresholds: result.thresholds,
                totalFlags: result.totalFlags,
                bySeverity: result.bySeverity,
                byType: result.byType,
                totalImpact: money(result.totalImpact),
                totalRows: paged.totalRows,
                returned: paged.returned,
                offset: paged.offset,
                hasMore: paged.hasMore,
                truncated: paged.truncated,
                // Named separately from `truncated`, which is about paging. This
                // one means a detector stopped looking, so "no other problems"
                // would be a false statement rather than a short list.
                incompleteChecks: result.truncatedDetectors.length ? result.truncatedDetectors : null,
                // A clean scan is a real answer, and the model reads an empty
                // rows array as "the tool failed" often enough to be worth saying.
                ...(result.totalFlags === 0
                    ? {
                          note: [
                              note,
                              'Nothing tripped any check for this period at this sensitivity. That is a clean result, ' +
                                  'not a missing one — say so plainly, and mention which checks ran if the user asks.',
                          ]
                              .filter(Boolean)
                              .join(' '),
                      }
                    : {}),
                guidance:
                    'These are statistical flags, not findings. A flag means the transaction differs from this ' +
                    'business\'s own history — the usual explanation is a data-entry slip, then a genuine one-off ' +
                    'deal, then an error worth chasing. Report the number of flags, lead with the highest-impact ' +
                    'ones, and quote `expected` and `baselineSamples` so the user can judge for themselves. Never ' +
                    'name a person as responsible; `enteredBy` says who keyed the record, not who caused it.',
                rows: paged.rows.map((a) => ({
                    type: a.type,
                    severity: a.severity,
                    document: a.document,
                    date: a.documentDate,
                    branch: a.branch,
                    party: a.party,
                    product: a.product,
                    observed: a.observed,
                    expected: a.expected,
                    deviationPct: a.deviationPct,
                    baselineSamples: a.baselineSamples,
                    impact: money(a.impact),
                    detail: a.detail,
                    enteredBy: a.enteredBy,
                })),
            };
        },
    },
];

function asSensitivity(value: unknown): AnomalySensitivity | undefined {
    return value === 'high' || value === 'normal' || value === 'low' ? value : undefined;
}
