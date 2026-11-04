import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CrmLeadGenerationService } from './crm-lead-generation.service';
import { WebToolRefusal } from '../ai/web-search.service';

function makeService(over: {
    webEnabled?: boolean;
    searchAnswer?: string;
    extractText?: string;
    existingLeads?: Array<{ id: string; name: string; website_url: string | null }>;
    enforce?: () => Promise<void>;
} = {}) {
    const ai: any = {
        enforceCredits: jest.fn().mockImplementation(over.enforce ?? (async () => undefined)),
        getDefaultModel: jest.fn().mockResolvedValue('anthropic/claude-haiku-4.5'),
        completeUnbilled: jest.fn().mockResolvedValue({
            text: over.extractText ?? JSON.stringify({
                candidates: [
                    {
                        company_name: 'Acme Soft',
                        website_url: 'https://acmesoft.com',
                        fit_score: 88,
                        fit_reason: 'Builds B2B SaaS for retailers',
                        description: 'Custom ERP for SMEs',
                        location: 'Dhaka',
                    },
                ],
            }),
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
            model: 'anthropic/claude-haiku-4.5',
        }),
        logUsage: jest.fn().mockResolvedValue(1.5),
    };

    const webSearch: any = {
        isEnabled: jest.fn().mockResolvedValue(over.webEnabled ?? true),
        search: jest.fn().mockResolvedValue({
            result: {
                query: 'software companies',
                answer: over.searchAnswer ?? 'Acme Soft (acmesoft.com) builds ERP for SMEs in Dhaka.',
                sources: [{ url: 'https://acmesoft.com', title: 'Acme Soft' }],
                excerpts: [{ url: 'https://acmesoft.com', content: 'Custom ERP for Bangladeshi retailers.' }],
            },
            creditsUsed: 2,
        }),
    };

    const db: any = {
        lead: {
            findMany: jest.fn().mockResolvedValue(over.existingLeads ?? []),
        },
    };

    const leads: any = {
        create: jest.fn().mockImplementation(async (_tenant: string, _user: string, dto: { name: string }) => ({
            id: `lead-${dto.name}`,
            name: dto.name,
        })),
    };

    return {
        service: new CrmLeadGenerationService(ai, webSearch, db, leads),
        ai,
        webSearch,
        db,
        leads,
    };
}

describe('CrmLeadGenerationService.search', () => {
    it('refuses before spending a search when the tenant is out of AI credits', async () => {
        const { service, ai, webSearch } = makeService({
            enforce: async () => {
                throw new ForbiddenException('AI credit limit reached');
            },
        });

        await expect(service.search('t1', { niche: 'SaaS' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(ai.enforceCredits).toHaveBeenCalledWith('t1');
        expect(webSearch.search).not.toHaveBeenCalled();
        expect(ai.completeUnbilled).not.toHaveBeenCalled();
    });

    it('searches the web for software companies and returns scored candidates', async () => {
        const { service, webSearch, ai } = makeService();

        const result = await service.search('t1', { niche: 'B2B SaaS', location: 'Dhaka', limit: 6 });

        expect(webSearch.search).toHaveBeenCalled();
        const query = webSearch.search.mock.calls[0][1] as string;
        expect(query.toLowerCase()).toContain('software compan');
        expect(query).toContain('B2B SaaS');
        expect(query).toContain('Dhaka');
        expect(ai.completeUnbilled).toHaveBeenCalled();
        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0].company_name).toBe('Acme Soft');
        expect(result.candidates[0].existing_lead_id).toBeNull();
        expect(result.web_search).toBe(true);
        expect(result.credits_used).toBeGreaterThan(0);
    });

    it('still finds well-known companies when web search is off, marked unverified', async () => {
        const { service, webSearch, ai } = makeService({
            webEnabled: false,
            extractText: JSON.stringify({
                candidates: [
                    {
                        company_name: 'Microsoft',
                        website_url: 'https://microsoft.com',
                        fit_score: 40,
                        unverified: true,
                    },
                ],
            }),
        });

        const result = await service.search('t1', {});

        expect(webSearch.search).not.toHaveBeenCalled();
        expect(ai.completeUnbilled).toHaveBeenCalled();
        expect(result.web_search).toBe(false);
        expect(result.candidates[0].unverified).toBe(true);
    });

    it('flags a company that is already a lead so it is not imported twice', async () => {
        const { service } = makeService({
            existingLeads: [{ id: 'lead-1', name: 'Acme Soft Ltd', website_url: 'https://www.acmesoft.com/' }],
        });

        const result = await service.search('t1', {});
        expect(result.candidates[0].existing_lead_id).toBe('lead-1');
    });

    it('surfaces a web-search refusal as a 400 the UI can show', async () => {
        const { service, webSearch } = makeService();
        webSearch.search.mockRejectedValue(new WebToolRefusal('This business has used its 50 web searches for today.'));

        await expect(service.search('t1', {})).rejects.toBeInstanceOf(BadRequestException);
    });
});

describe('CrmLeadGenerationService.importCandidates', () => {
    it('creates a lead for each new company and skips ones already in CRM', async () => {
        const { service, leads } = makeService();

        const result = await service.importCandidates('t1', 'user-1', 'Asia/Dhaka', [
            {
                company_name: 'Acme Soft',
                website_url: 'https://acmesoft.com',
                description: 'Custom ERP',
                fit_reason: 'Sells to SMEs',
            },
            {
                company_name: 'Old Soft',
                website_url: 'https://oldsoft.com',
                existing_lead_id: 'lead-old',
            },
        ]);

        expect(leads.create).toHaveBeenCalledTimes(1);
        const dto = leads.create.mock.calls[0][2];
        expect(dto.name).toBe('Acme Soft');
        expect(dto.website_url).toBe('https://acmesoft.com');
        expect(dto.remarks).toContain('Found via AI lead generation');
        expect(dto.source).toBe('WEBSITE');
        expect(dto.category).toBe('CORPORATE');
        expect(result.created).toHaveLength(1);
        expect(result.skipped).toEqual([{ company_name: 'Old Soft', reason: 'already_in_crm', lead_id: 'lead-old' }]);
    });

    it('rejects an empty selection', async () => {
        const { service } = makeService();
        await expect(service.importCandidates('t1', 'user-1', 'Asia/Dhaka', [])).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });
});
