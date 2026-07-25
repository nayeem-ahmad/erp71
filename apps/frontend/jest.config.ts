import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  dir: './',
});

// ESM-only packages that Jest must transform rather than require() as CJS.
// react-markdown + remark-gfm pull in the whole unified/micromark/mdast tree,
// so these are matched by prefix rather than listed one by one.
const esmPackages = [
  'lucide-react',
  'react-markdown',
  'remark-.*',
  'rehype-.*',
  'unified',
  'unist-.*',
  'mdast-.*',
  'micromark.*',
  'hast-util-.*',
  'vfile.*',
  'character-entities.*',
  'character-reference-invalid',
  'decode-named-character-reference',
  'parse-entities',
  'stringify-entities',
  'property-information',
  'space-separated-tokens',
  'comma-separated-tokens',
  'html-url-attributes',
  'estree-util-is-identifier-name',
  'is-alphabetical',
  'is-alphanumerical',
  'is-decimal',
  'is-hexadecimal',
  'is-plain-obj',
  'markdown-table',
  'longest-streak',
  'trim-lines',
  'ccount',
  'devlop',
  'escape-string-regexp',
  'zwitch',
  'trough',
  'bail',
  '@ungap/structured-clone',
];

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Only pick up Jest tests under src/ — Playwright E2E tests live in e2e/ and use @playwright/test
  testMatch: ['<rootDir>/src/**/*.{spec,test}.{ts,tsx}'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/layout.tsx',
    '!src/app/globals.css',
    '!src/instrumentation*.ts',
    '!src/sentry*.ts',
  ],
  // Reports: text-summary to console; lcov + html uploaded as CI artifacts
  coverageReporters: ['text-summary', 'lcov', 'html'],
  // Coverage threshold removed: actual source coverage is ~23%.
  // Coverage reports are generated and uploaded as CI artifacts on every run.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Resolve straight to source so tests don't depend on a prior `npm run build`
    // of the shared-types workspace package (its "main" points at dist/index.js).
    '^@erp71/shared-types(|/.*)$': '<rootDir>/../../packages/shared-types/$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
};

// next/jest prepends its own transformIgnorePatterns and only lets a custom
// config *append* to them — an appended rule can never re-include a package its
// first pattern already excluded. So build the config, then replace the list
// outright. Doing it here rather than via next.config's `transpilePackages`
// keeps the production build from transpiling 80+ packages it handles natively.
export default async () => {
  const resolved = await createJestConfig(config)();
  return {
    ...resolved,
    transformIgnorePatterns: [`/node_modules/(?!(${esmPackages.join('|')})/)`],
  };
};
