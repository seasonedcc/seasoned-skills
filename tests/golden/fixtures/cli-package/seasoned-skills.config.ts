import { defineConfig } from '../../../../src/index.js'

export default defineConfig({
  projectName: 'seasoned-skills',
  contentDir: 'workflow-content',
  mergeStrategy: 'merge-commit',
  release: {
    target: 'published-package',
    packages: [{ name: 'seasoned-skills', publishCommand: 'pnpm release' }],
  },
  gates: {
    lint: 'pnpm run check',
    typecheck: 'pnpm run tsc',
    unit: 'pnpm run test:unit',
    full: ['pnpm run test'],
  },
  calibrationFile: 'workflow-content/calibrations.md',
})
