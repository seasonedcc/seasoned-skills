import { defineConfig } from '../../../../src/index.js'

export default defineConfig({
  projectName: 'Acme Ledger',
  contentDir: 'workflow-content',
  mergeStrategy: 'squash',
  release: { target: 'deployed-product' },
  gates: {
    lint: 'pnpm run lint',
    typecheck: 'pnpm run tsc',
    unit: 'pnpm run test:unit',
    full: ['pnpm run test'],
  },
  calibrationFile: 'workflow-content/calibrations.md',
  quickDisqualifiers: [
    'a change to the posting rules or the chart of accounts',
    'a change to a published endpoint contract',
  ],
})
