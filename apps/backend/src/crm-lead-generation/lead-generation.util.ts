import { organizationNameNorm } from '@erp71/shared-types';

export const DEFAULT_NICHE = 'custom software, SaaS, or IT services';
export const DEFAULT_LOCATION = 'Bangladesh';
export const DEFAULT_CANDIDATE_LIMIT = 8;
export const MAX_CANDIDATE_LIMIT = 15;

export type LeadGenerationBrief = {
    niche: string;
    location: string;
    companySize: string;
    keywords: string;
    limit: number;
};

export type ParsedCandidate = {
    company_name: string;
    website_url: string | null;
    linkedin_url: string | null;
    email: string | null;
    location: string | null;
    description: string | null;
    fit_score: number;
    fit_reason: string | null;
    source_url: string | null;
    unverified: boolean;
};

export type ExistingLeadRef = {
    id: string;
    name: string;
    website_url: string | null;
};

export type RankedCandidate = ParsedCandidate & {
    existing_lead_id: string | null;
    existing_lead_name: string | null;
};

export function clampCandidateLimit(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_CANDIDATE_LIMIT;
    return Math.min(MAX_CANDIDATE_LIMIT, Math.max(1, Math.trunc(n)));
}

export function normalizeBrief(input: {
    niche?: string;
    location?: string;
    companySize?: string;
    keywords?: string;
    limit?: number;
}): LeadGenerationBrief {
    return {
        niche: (input.niche ?? '').trim() || DEFAULT_NICHE,
        location: (input.location ?? '').trim() || DEFAULT_LOCATION,
        companySize: (input.companySize ?? '').trim(),
        keywords: (input.keywords ?? '').trim(),
        limit: clampCandidateLimit(input.limit),
    };
}

/**
 * Always a software-company search. A niche like "restaurants" becomes
 * software companies that serve restaurants, not restaurants themselves.
 */
export function buildSearchQuery(brief: LeadGenerationBrief): string {
    const niche = brief.niche.trim();
    const parts = [
        'software companies',
        niche ? `specialising in ${niche}` : '',
        brief.location.trim() ? `in ${brief.location.trim()}` : '',
        brief.companySize.trim() ? `with about ${brief.companySize.trim()}` : '',
        brief.keywords.trim() ? brief.keywords.trim() : '',
        `list ${brief.limit} companies with official websites`,
    ];
    return parts.filter(Boolean).join(' ');
}

export function normalizeWebsite(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    let value = raw.trim().toLowerCase();
    if (!value) return null;
    value = value.replace(/^https?:\/\//, '');
    value = value.replace(/^www\./, '');
    value = value.replace(/\/+$/, '');
    return value || null;
}

function blankToNull(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
}

function clampScore(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, Math.round(n)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function readCandidateList(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    const record = asRecord(payload);
    if (Array.isArray(record?.candidates)) return record.candidates as unknown[];
    return [];
}

export function parseCandidates(payload: unknown, limit: number): ParsedCandidate[] {
    const cap = clampCandidateLimit(limit);
    const rows: ParsedCandidate[] = [];
    for (const item of readCandidateList(payload)) {
        if (rows.length >= cap) break;
        const record = asRecord(item);
        if (!record) continue;
        const companyName = blankToNull(record.company_name ?? record.companyName ?? record.name);
        if (!companyName) continue;
        rows.push({
            company_name: companyName,
            website_url: blankToNull(record.website_url ?? record.websiteUrl ?? record.website),
            linkedin_url: blankToNull(record.linkedin_url ?? record.linkedinUrl ?? record.linkedin),
            email: blankToNull(record.email),
            location: blankToNull(record.location),
            description: blankToNull(record.description),
            fit_score: clampScore(record.fit_score ?? record.fitScore),
            fit_reason: blankToNull(record.fit_reason ?? record.fitReason),
            source_url: blankToNull(record.source_url ?? record.sourceUrl),
            unverified: record.unverified === true,
        });
    }
    return rows;
}

export function markDuplicates(
    candidates: ParsedCandidate[],
    existing: ExistingLeadRef[],
): RankedCandidate[] {
    const byWebsite = new Map<string, ExistingLeadRef>();
    const byName = new Map<string, ExistingLeadRef>();
    for (const lead of existing) {
        const website = normalizeWebsite(lead.website_url);
        if (website && !byWebsite.has(website)) byWebsite.set(website, lead);
        const name = organizationNameNorm(lead.name);
        if (name && !byName.has(name)) byName.set(name, lead);
    }

    return candidates.map((candidate) => {
        const websiteHit = normalizeWebsite(candidate.website_url);
        const nameHit = organizationNameNorm(candidate.company_name);
        const match = (websiteHit && byWebsite.get(websiteHit)) || (nameHit ? byName.get(nameHit) : undefined);
        return {
            ...candidate,
            existing_lead_id: match?.id ?? null,
            existing_lead_name: match?.name ?? null,
        };
    });
}

export function leadRemarksFor(candidate: ParsedCandidate): string {
    const lines = [
        candidate.description,
        candidate.fit_reason ? `Why it fits: ${candidate.fit_reason}` : null,
        candidate.location ? `Location: ${candidate.location}` : null,
        candidate.source_url ? `Source: ${candidate.source_url}` : null,
        'Found via AI lead generation (software companies).',
        candidate.unverified ? 'Unverified — review before contacting.' : null,
    ];
    return lines.filter(Boolean).join('\n');
}
