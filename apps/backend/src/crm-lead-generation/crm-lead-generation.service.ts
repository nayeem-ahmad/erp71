import { BadRequestException, Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { WebSearchService, WebToolRefusal } from '../ai/web-search.service';
import { DatabaseService } from '../database/database.service';
import { CrmLeadsService } from '../crm-leads/crm-leads.service';
import { extractJson } from '../ai/extract-json';
import {
    buildSearchQuery,
    leadRemarksFor,
    markDuplicates,
    normalizeBrief,
    parseCandidates,
    type ParsedCandidate,
} from './lead-generation.util';

const EXTRACT_MAX_TOKENS = 1800;

const EXTRACT_PROMPT = [
    'You extract software-company prospects for a CRM from the research below.',
    'Only include companies that build, sell, or implement software (SaaS, custom development, product studios, IT services, system integrators).',
    'Exclude retailers, restaurants, and any business that is not a software company.',
    'Never invent an email, phone number, or LinkedIn URL. Leave those null unless they appear in the sources.',
    'Return JSON only, no prose:',
    '{ "candidates": [ { "company_name": "", "website_url": null, "linkedin_url": null, "email": null, "location": null, "description": "", "fit_score": 0, "fit_reason": "", "source_url": null, "unverified": false } ] }',
    'fit_score is 0-100 for how well the company matches the brief.',
].join('\n');

const KNOWLEDGE_PROMPT = [
    EXTRACT_PROMPT,
    'Web search is unavailable. Only list well-known software companies you are confident exist.',
    'Set unverified to true on every candidate. Leave email, linkedin_url and phone null.',
].join('\n');

export type ImportCandidateInput = {
    company_name?: string;
    website_url?: string | null;
    linkedin_url?: string | null;
    email?: string | null;
    location?: string | null;
    description?: string | null;
    fit_score?: number;
    fit_reason?: string | null;
    source_url?: string | null;
    unverified?: boolean;
    existing_lead_id?: string | null;
};

@Injectable()
export class CrmLeadGenerationService {
    constructor(
        private readonly ai: AiService,
        private readonly webSearch: WebSearchService,
        private readonly db: DatabaseService,
        private readonly leads: CrmLeadsService,
    ) {}

    async search(tenantId: string, input: {
        niche?: string;
        location?: string;
        companySize?: string;
        keywords?: string;
        limit?: number;
    }) {
        await this.ai.enforceCredits(tenantId);

        const brief = normalizeBrief(input);
        const query = buildSearchQuery(brief);
        const webEnabled = await this.webSearch.isEnabled();

        let extractUser = `Brief: ${query}`;
        let searchCredits = 0;

        if (webEnabled) {
            try {
                const { result, creditsUsed } = await this.webSearch.search(tenantId, query);
                searchCredits = creditsUsed;
                extractUser = [
                    `Brief: ${query}`,
                    '',
                    'Search summary:',
                    result.answer,
                    '',
                    'Sources:',
                    result.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n') || '(none)',
                    '',
                    'Excerpts:',
                    result.excerpts.map((e) => `- ${e.url}: ${e.content}`).join('\n') || '(none)',
                ].join('\n');
            } catch (err) {
                if (err instanceof WebToolRefusal) {
                    throw new BadRequestException(err.message);
                }
                throw err;
            }
        }

        const model = await this.ai.getDefaultModel();
        const { text, usage, model: usedModel } = await this.ai.completeUnbilled(
            model,
            webEnabled ? EXTRACT_PROMPT : KNOWLEDGE_PROMPT,
            extractUser,
            EXTRACT_MAX_TOKENS,
        );
        const extractCredits = await this.ai.logUsage(tenantId, 'lead_generation', usedModel, usage);

        const parsed = parseCandidates(extractJson<unknown>(text), brief.limit);
        const candidates = webEnabled
            ? parsed
            : parsed.map((row) => ({ ...row, unverified: true }));

        const existing = await this.db.lead.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, name: true, website_url: true },
        });

        return {
            query,
            web_search: webEnabled,
            credits_used: searchCredits + extractCredits,
            candidates: markDuplicates(candidates, existing),
        };
    }

    async importCandidates(
        tenantId: string,
        userId: string,
        timezone: string,
        rows: ImportCandidateInput[],
    ) {
        if (!rows.length) {
            throw new BadRequestException('Select at least one company to add as a lead.');
        }

        const created: Array<{ id: string; name: string }> = [];
        const skipped: Array<{ company_name: string; reason: string; lead_id?: string }> = [];
        const failed: Array<{ company_name: string; reason: string }> = [];

        for (const row of rows) {
            const name = (row.company_name ?? '').trim();
            if (!name) {
                skipped.push({ company_name: '', reason: 'missing_name' });
                continue;
            }
            if (row.existing_lead_id) {
                skipped.push({ company_name: name, reason: 'already_in_crm', lead_id: row.existing_lead_id });
                continue;
            }

            const candidate: ParsedCandidate = {
                company_name: name,
                website_url: row.website_url?.trim() || null,
                linkedin_url: row.linkedin_url?.trim() || null,
                email: usableEmail(row.email),
                location: row.location?.trim() || null,
                description: row.description?.trim() || null,
                fit_score: Number.isFinite(row.fit_score) ? Number(row.fit_score) : 0,
                fit_reason: row.fit_reason?.trim() || null,
                source_url: row.source_url?.trim() || null,
                unverified: row.unverified === true,
            };

            try {
                const lead = await this.leads.create(tenantId, userId, {
                    name,
                    website_url: candidate.website_url ?? undefined,
                    linkedin_url: candidate.linkedin_url ?? undefined,
                    email: candidate.email ?? undefined,
                    address: candidate.location ?? undefined,
                    remarks: leadRemarksFor(candidate),
                    source: 'WEBSITE',
                    category: 'CORPORATE',
                }, timezone);
                created.push({ id: lead.id, name: lead.name });
            } catch (err) {
                failed.push({
                    company_name: name,
                    reason: err instanceof Error ? err.message : 'create_failed',
                });
            }
        }

        return { created, skipped, failed };
    }
}

function usableEmail(raw: string | null | undefined): string | null {
    const value = (raw ?? '').trim();
    if (!value || !value.includes('@') || !value.includes('.')) return null;
    return value;
}
