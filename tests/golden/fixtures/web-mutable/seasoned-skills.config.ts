import { defineConfig } from '../../../../src/index.js'

export default defineConfig({
  projectName: 'Acme Field Service',
  contentDir: 'workflow-content',
  mergeStrategy: 'merge-commit',
  release: { target: 'deployed-product' },
  gates: {
    lint: 'pnpm run lint',
    typecheck: 'pnpm run tsc',
    unit: 'pnpm run test:unit',
    relatedSpecs: 'pnpm run test:e2e --grep',
    full: ['pnpm run test'],
  },
  calibrationFile: 'workflow-content/calibrations.md',
  webSurface: {
    coverageRegister: 'tests/coverage/pending.ts',
    excusedSurfaces: 'tests/coverage/excused.ts',
  },
  stack: {
    name: 'react-router-kysely',
    databaseMutability: 'mutable-when-not-derivable',
  },
})
