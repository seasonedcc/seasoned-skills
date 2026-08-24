import { defineConfig } from '../../../../src/index.js'

export default defineConfig({
  projectName: 'Acme Operations',
  contentDir: 'workflow-content',
  mergeStrategy: 'merge-commit',
  agentMergesDuringGoal: true,
  outOfScopeFindings: 'autofix',
  release: { target: 'deployed-product' },
  gates: {
    lint: 'pnpm run lint',
    typecheck: 'pnpm run tsc',
    unit: 'pnpm run test:unit',
    relatedSpecs: 'pnpm run build && pnpm run test:e2e',
    full: ['pnpm run test'],
  },
  calibrationFile: 'workflow-content/calibrations.md',
  webSurface: {
    coverageRegister: 'tests/coverage/pending.ts',
    excusedSurfaces: 'tests/coverage/excused.ts',
  },
  demoSeed: { seedManifest: 'app/db/dev-seed/manifest.ts' },
  machineSurface: {
    parityStandard: 'app/mcp/PARITY.md',
    exceptionRegister: 'app/mcp/exceptions.ts',
  },
  stack: {
    name: 'react-router-kysely',
    databaseMutability: 'append-only',
  },
  provisioning: {
    repositories: [
      {
        path: '.',
        databases: [{ name: 'acme_operations', derivedPatterns: ['{database}_e2e'] }],
        portBases: { app: 7000, maildev: 1080 },
        templateCaching: true,
      },
    ],
  },
  additionalCriteria: [
    {
      text: 'A task is not done if it adds, changes, or removes a user-facing product surface without updating the docs in the same PR.',
      backedBy: 'the docs-writing skill and the docs coverage manifest',
      quickDisposition: 'excluded',
    },
  ],
})
