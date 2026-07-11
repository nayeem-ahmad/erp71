import { DeployService } from './deploy.service';

describe('DeployService', () => {
    let service: DeployService;
    let github: any;
    let audit: any;
    const ORIGINAL_SHA = process.env.GIT_SHA;

    beforeEach(() => {
        github = {
            getBranches: jest.fn().mockResolvedValue({ baseBranch: 'dev', productionBranch: 'main' }),
            triggerDeployWorkflow: jest.fn().mockResolvedValue(undefined),
            compareBranches: jest.fn(),
            getLatestDeployRun: jest.fn(),
        };
        audit = { log: jest.fn().mockResolvedValue(undefined) };
        service = new DeployService(github, audit);
    });

    afterEach(() => {
        if (ORIGINAL_SHA === undefined) delete process.env.GIT_SHA;
        else process.env.GIT_SHA = ORIGINAL_SHA;
    });

    describe('triggerDeploy', () => {
        it('dispatches the deploy workflow for the production branch and audits it', async () => {
            const result = await service.triggerDeploy('admin-1');

            expect(github.triggerDeployWorkflow).toHaveBeenCalledWith('main');
            expect(audit.log).toHaveBeenCalledWith('deploy.triggered', 'Deploy', { userId: 'admin-1' }, undefined, { branch: 'main' });
            expect(result).toEqual({ triggered: true, branch: 'main' });
        });
    });

    describe('getStatus', () => {
        it('reports live SHA, production tip, ahead-by, and the last run', async () => {
            process.env.GIT_SHA = 'live-sha';
            github.compareBranches.mockResolvedValue({ aheadBy: 4, baseSha: 'live-sha', headSha: 'main-tip' });
            github.getLatestDeployRun.mockResolvedValue({ id: 5, status: 'completed', conclusion: 'success', url: 'u', createdAt: 't', title: 'x' });

            const status = await service.getStatus();

            expect(github.compareBranches).toHaveBeenCalledWith('live-sha', 'main');
            expect(status).toEqual({
                liveSha: 'live-sha',
                productionBranch: 'main',
                mainSha: 'main-tip',
                aheadBy: 4,
                lastRun: expect.objectContaining({ id: 5, conclusion: 'success' }),
            });
        });

        it('reports aheadBy=null when the live SHA is unknown', async () => {
            delete process.env.GIT_SHA;
            github.compareBranches.mockResolvedValue({ aheadBy: 0, baseSha: 'main-tip', headSha: 'main-tip' });
            github.getLatestDeployRun.mockResolvedValue(null);

            const status = await service.getStatus();

            expect(status.liveSha).toBeNull();
            expect(status.aheadBy).toBeNull();
            expect(status.mainSha).toBe('main-tip');
        });

        it('degrades gracefully when the compare fails (e.g. unknown live SHA ref)', async () => {
            process.env.GIT_SHA = 'bogus';
            github.compareBranches.mockRejectedValue(new Error('404 Not Found'));
            github.getLatestDeployRun.mockResolvedValue(null);

            const status = await service.getStatus();

            expect(status.liveSha).toBe('bogus');
            expect(status.mainSha).toBeNull();
            expect(status.aheadBy).toBeNull();
            expect(status.lastRun).toBeNull();
        });
    });
});
