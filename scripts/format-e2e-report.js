#!/usr/bin/env node
/**
 * Formats a Playwright JSON report into an email-ready summary for the nightly
 * read-only E2E smoke test.
 *
 * Usage: node scripts/format-e2e-report.js <playwright-results.json> [stderr-log]
 *
 * Outputs:
 *   - Writes `e2e-report.html` (HTML email body) next to the CWD.
 *   - Appends `subject`, `status`, and `failed_count` to $GITHUB_OUTPUT (if set).
 *
 * Exit code is always 0 — the job's pass/fail signal is carried in the email,
 * not in this formatter.
 */

const fs = require('fs');

const resultsPath = process.argv[2] || 'playwright-results.json';
const stderrPath = process.argv[3] || null;

const TZ_LABEL = 'Asia/Dhaka';
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || '(unknown target)';

// Strip ANSI colour codes that Playwright embeds in error messages.
function stripAnsi(str) {
    // eslint-disable-next-line no-control-regex
    return String(str || '').replace(/\[[0-9;]*m/g, '');
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Recursively walk the Playwright suite tree, collecting one entry per spec.
function collectSpecs(suite, titlePath, out) {
    const path = suite.title ? [...titlePath, suite.title] : titlePath;

    for (const spec of suite.specs || []) {
        const fullTitle = [...path, spec.title].filter(Boolean).join(' › ');
        // A spec may contain multiple tests/results; surface the first error.
        let errorMsg = '';
        for (const test of spec.tests || []) {
            for (const result of test.results || []) {
                if (result.status !== 'passed' && result.status !== 'skipped' && result.error) {
                    errorMsg = stripAnsi(result.error.message || '').split('\n')[0];
                    break;
                }
            }
            if (errorMsg) break;
        }
        out.push({ title: fullTitle, ok: spec.ok !== false, errorMsg });
    }

    for (const child of suite.suites || []) {
        collectSpecs(child, path, out);
    }
}

let report = null;
let parseError = null;
try {
    const raw = fs.readFileSync(resultsPath, 'utf8');
    report = JSON.parse(raw);
} catch (err) {
    parseError = err.message;
}

const now = new Date().toLocaleString('en-GB', { timeZone: TZ_LABEL, hour12: false });

let subject;
let html;
let failedCount = 0;
let status = 'pass';

if (parseError || !report) {
    // Playwright likely crashed before emitting a report — treat as a hard failure.
    status = 'error';
    failedCount = -1;
    const stderrTail = stderrPath && fs.existsSync(stderrPath)
        ? fs.readFileSync(stderrPath, 'utf8').split('\n').slice(-40).join('\n')
        : '(no stderr captured)';
    subject = '⚠️ Nightly read-only E2E could not run';
    html = `
      <h2 style="color:#b91c1c">⚠️ Nightly read-only E2E smoke test could not run</h2>
      <p><strong>Target:</strong> ${escapeHtml(baseUrl)}<br>
         <strong>When:</strong> ${escapeHtml(now)} (${TZ_LABEL})</p>
      <p>The Playwright run did not produce a results file. This usually means the
         app was unreachable or the test runner failed to start.</p>
      <p><strong>Parse error:</strong> ${escapeHtml(parseError || 'no report file')}</p>
      <pre style="background:#f4f4f5;padding:12px;border-radius:6px;overflow:auto;font-size:12px">${escapeHtml(stderrTail)}</pre>`;
} else {
    const specs = [];
    for (const suite of report.suites || []) {
        collectSpecs(suite, [], specs);
    }

    const stats = report.stats || {};
    const total = specs.length;
    const failed = specs.filter((s) => !s.ok);
    failedCount = failed.length;
    const passed = total - failedCount;
    const duration = stats.duration ? `${(stats.duration / 1000).toFixed(1)}s` : 'n/a';

    status = failedCount === 0 ? 'pass' : 'fail';
    const icon = failedCount === 0 ? '✅' : '❌';
    subject = failedCount === 0
        ? `${icon} Nightly E2E: all ${passed} read-only checks passed`
        : `${icon} Nightly E2E: ${failedCount} failed of ${total} read-only checks`;

    const failedList = failedCount === 0
        ? '<p style="color:#15803d">No failures — every feature route and read-only flow is up. 🎉</p>'
        : `<h3 style="color:#b91c1c">Failed cases (${failedCount})</h3>
           <ul>${failed.map((f) =>
                `<li><strong>${escapeHtml(f.title)}</strong>${
                    f.errorMsg ? `<br><span style="color:#6b7280;font-size:12px">${escapeHtml(f.errorMsg)}</span>` : ''
                }</li>`).join('')}</ul>`;

    html = `
      <h2>${icon} Nightly read-only E2E smoke test</h2>
      <p><strong>Target:</strong> ${escapeHtml(baseUrl)}<br>
         <strong>When:</strong> ${escapeHtml(now)} (${TZ_LABEL})</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:2px 12px 2px 0">Passed</td><td><strong style="color:#15803d">${passed}</strong></td></tr>
        <tr><td style="padding:2px 12px 2px 0">Failed</td><td><strong style="color:${failedCount ? '#b91c1c' : '#15803d'}">${failedCount}</strong></td></tr>
        <tr><td style="padding:2px 12px 2px 0">Total</td><td>${total}</td></tr>
        <tr><td style="padding:2px 12px 2px 0">Duration</td><td>${duration}</td></tr>
      </table>
      ${failedList}
      <hr>
      <p style="color:#9ca3af;font-size:12px">Automated nightly run from the
         <code>Nightly Read-Only E2E</code> GitHub Actions workflow.</p>`;
}

fs.writeFileSync('e2e-report.html', html);

if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `subject=${subject}\nstatus=${status}\nfailed_count=${failedCount}\n`,
    );
}

// Echo a short summary to the job log.
console.log(subject);
