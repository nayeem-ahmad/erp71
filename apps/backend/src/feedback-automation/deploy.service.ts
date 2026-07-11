import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DeployRun, FeedbackGithubService } from './feedback-github.service';

export interface DeployStatus {
    /** Git SHA the running backend was built from — what is actually live in production. */
    liveSha: string | null;
    productionBranch: string;
    /** Tip of the production branch (what a deploy would ship). */
    mainSha: string | null;
    /** How many commits production is ahead of what is live, or null when the live SHA is unknown. */
    aheadBy: number | null;
    lastRun: DeployRun | null;
}

/**
 * Drives the in-app "Deploy to Production" control (platform admin). Triggering dispatches the
 * existing Deploy-to-VPS GitHub workflow so the deploy runs on an external runner — the backend
 * never tears down its own container mid-deploy. Status reports what is live vs. what is on the
 * production branch, plus the latest deploy run.
 */
@Injectable()
export class DeployService {
    private readonly logger = new Logger(DeployService.name);

    constructor(
        private readonly github: FeedbackGithubService,
        private readonly audit: AuditService,
    ) {}

    async triggerDeploy(adminUserId: string): Promise<{ triggered: true; branch: string }> {
        const { productionBranch } = await this.github.getBranches();
        await this.github.triggerDeployWorkflow(productionBranch);
        await this.audit.log('deploy.triggered', 'Deploy', { userId: adminUserId }, undefined, { branch: productionBranch });
        this.logger.log(`Production deploy dispatched for ${productionBranch} by ${adminUserId}`);
        return { triggered: true, branch: productionBranch };
    }

    async getStatus(): Promise<DeployStatus> {
        const liveSha = process.env.GIT_SHA ?? null;
        const { productionBranch } = await this.github.getBranches();

        let mainSha: string | null = null;
        let aheadBy: number | null = null;
        try {
            // Compare live→production: headSha is the production tip, aheadBy is commits waiting to ship.
            const cmp = await this.github.compareBranches(liveSha ?? productionBranch, productionBranch);
            mainSha = cmp.headSha || null;
            aheadBy = liveSha ? cmp.aheadBy : null;
        } catch (err) {
            // A bad/unknown live SHA (e.g. a dev build without GIT_SHA) makes compare fail — degrade gracefully.
            this.logger.warn(`Could not compare live SHA to ${productionBranch}: ${err instanceof Error ? err.message : String(err)}`);
        }

        const lastRun = await this.github.getLatestDeployRun().catch(() => null);
        return { liveSha, productionBranch, mainSha, aheadBy, lastRun };
    }
}
