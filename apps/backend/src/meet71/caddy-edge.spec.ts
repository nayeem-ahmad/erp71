import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.join(__dirname, '../../../..');
const CADDY_EDGE = path.join(REPO, 'scripts/caddy-edge.sh');
const COMPOSE = path.join(REPO, 'docker-compose.prod.yml');
const DEPLOY = path.join(REPO, 'scripts/deploy.sh');
const SMOKE = path.join(REPO, 'scripts/smoke-check.sh');

function bash(script: string, env: NodeJS.ProcessEnv = {}): { status: number; stdout: string; stderr: string } {
    const r = spawnSync('bash', ['-c', script], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
    });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function withTempRepo(fn: (dir: string) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-edge-'));
    try {
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('PR3: compose Caddy is the public edge', () => {
    it('caddy is not gated behind standalone-edge', () => {
        const yml = fs.readFileSync(COMPOSE, 'utf8');
        expect(yml).not.toMatch(/standalone-edge/);
        expect(yml).toMatch(/^\s+caddy:\s*$/m);
        expect(yml).toMatch(/image: caddy:2\.9-alpine/);
        expect(yml).toMatch(/- "80:80"/);
        expect(yml).toMatch(/- "443:443"/);
        expect(yml).toMatch(/\.\/Caddyfile\.neighbors:\/etc\/caddy\/Caddyfile\.neighbors:ro/);
        const caddyStart = yml.indexOf('\n  caddy:');
        const caddyBlock = yml.slice(caddyStart, yml.indexOf('\nvolumes:', caddyStart));
        expect(caddyBlock).toMatch(/depends_on:\s*\n\s+- frontend\s*\n\s+- backend/);
        expect(caddyBlock).not.toMatch(/meet71/);
    });

    it('deploy.sh drops Hermes attach_caddy and fail-closes neighbors', () => {
        const sh = fs.readFileSync(DEPLOY, 'utf8');
        expect(sh).not.toMatch(/hermes-webui-proxy/);
        expect(sh).not.toMatch(/hermes-caddy-1/);
        expect(sh).toMatch(/scripts\/caddy-edge\.sh/);
        expect(sh).toMatch(/ensure_neighbors_file/);
        expect(sh).toMatch(/sync_caddy_config/);
        expect(sh).toMatch(/attach_caddy_extra_networks/);
        expect(sh).not.toMatch(/Neighbor site blocks\. Not in git/);
    });

    it('smoke-check defaults to api.erp71.com / app.erp71.com', () => {
        const sh = fs.readFileSync(SMOKE, 'utf8');
        expect(sh).toMatch(/API_BASE="\$\{API_BASE:-https:\/\/api\.erp71\.com\}"/);
        expect(sh).toMatch(/APP_BASE="\$\{APP_BASE:-https:\/\/app\.erp71\.com\}"/);
        expect(sh).not.toMatch(/nayeemahmad\.com/);
    });
});

describe('ensure_neighbors_file (fail-closed)', () => {
    const source = `set -euo pipefail; source "${CADDY_EDGE}"`;

    it('exits 1 when the file is missing and points at the cutover backup', () => {
        withTempRepo((dir) => {
            const r = bash(`${source}; REPO_ROOT="${dir}" ensure_neighbors_file`, { REPO_ROOT: dir });
            expect(r.status).toBe(1);
            expect(r.stderr).toMatch(/Caddyfile\.neighbors/);
            expect(r.stderr).toMatch(/caddy-cutover-.*-neighbors\.bak/);
            expect(fs.existsSync(path.join(dir, 'Caddyfile.neighbors'))).toBe(false);
        });
    });

    it('exits 1 when the path is a directory', () => {
        withTempRepo((dir) => {
            fs.mkdirSync(path.join(dir, 'Caddyfile.neighbors'));
            const r = bash(`${source}; REPO_ROOT="${dir}" ensure_neighbors_file`, { REPO_ROOT: dir });
            expect(r.status).toBe(1);
            expect(r.stderr).toMatch(/directory/);
            expect(r.stderr).toMatch(/caddy-cutover-.*-neighbors\.bak/);
        });
    });

    it('exits 1 on a comment-only stub (no site blocks)', () => {
        withTempRepo((dir) => {
            fs.writeFileSync(
                path.join(dir, 'Caddyfile.neighbors'),
                '# Neighbor site blocks. Not in git. See docs/ops/deployment-runbook.md.\n',
            );
            const r = bash(`${source}; REPO_ROOT="${dir}" ensure_neighbors_file`, { REPO_ROOT: dir });
            expect(r.status).toBe(1);
            expect(r.stderr).toMatch(/site block/);
            expect(r.stderr).toMatch(/caddy-cutover-.*-neighbors\.bak/);
        });
    });

    it('accepts a real neighbor site block', () => {
        withTempRepo((dir) => {
            fs.writeFileSync(
                path.join(dir, 'Caddyfile.neighbors'),
                'scrum71.nayeemahmad.com {\n\treverse_proxy scrum71:80\n}\n',
            );
            const r = bash(`${source}; REPO_ROOT="${dir}" ensure_neighbors_file`, { REPO_ROOT: dir });
            expect(r.status).toBe(0);
            expect(r.stderr).toBe('');
        });
    });
});

describe('attach_caddy_extra_networks', () => {
    const source = `set -euo pipefail; source "${CADDY_EDGE}"`;

    it('warns and skips when the extra-nets file is missing', () => {
        withTempRepo((dir) => {
            const r = bash(`${source}; REPO_ROOT="${dir}" COMPOSE_PROJECT=erp71 attach_caddy_extra_networks`, {
                REPO_ROOT: dir,
            });
            expect(r.status).toBe(0);
            expect(r.stderr).toMatch(/caddy-extra-networks/);
            expect(r.stderr).toMatch(/WARN/);
        });
    });

    it('connects listed nets and treats already-connected as success', () => {
        withTempRepo((dir) => {
            fs.writeFileSync(path.join(dir, 'caddy-extra-networks'), 'jobxprss_default\nretail-saas_default\n');
            const bin = path.join(dir, 'bin');
            fs.mkdirSync(bin);
            const log = path.join(dir, 'docker.log');
            fs.writeFileSync(
                path.join(bin, 'docker'),
                `#!/usr/bin/env bash
echo "docker $*" >> "${log}"
if [ "$1" = network ] && [ "$2" = inspect ]; then
  exit 0
fi
if [ "$1" = network ] && [ "$2" = connect ]; then
  if [ "$3" = jobxprss_default ]; then
    echo "Error response from daemon: endpoint with name erp71-caddy-1 already exists in network jobxprss_default" >&2
    exit 1
  fi
  exit 0
fi
exit 0
`,
            );
            fs.chmodSync(path.join(bin, 'docker'), 0o755);
            const r = bash(`export PATH="${bin}:$PATH"; ${source}; REPO_ROOT="${dir}" COMPOSE_PROJECT=erp71 attach_caddy_extra_networks`, {
                REPO_ROOT: dir,
            });
            expect(r.status).toBe(0);
            const logText = fs.readFileSync(log, 'utf8');
            expect(logText).toMatch(/network connect jobxprss_default erp71-caddy-1/);
            expect(logText).toMatch(/network connect retail-saas_default erp71-caddy-1/);
        });
    });
});
