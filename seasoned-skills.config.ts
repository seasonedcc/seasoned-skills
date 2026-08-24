import { defineConfig } from 'seasoned-skills'

export default defineConfig({
  projectName: 'seasoned-skills',
  contentDir: 'workflow-content',
  mergeStrategy: 'merge-commit',
  agentMergesDuringGoal: true,
  outOfScopeFindings: 'bank',
  release: {
    target: 'published-package',
    packages: [{ name: 'seasoned-skills', publishCommand: 'pnpm publish' }],
  },
  gates: {
    lint: 'pnpm check',
    typecheck: 'pnpm tsc',
    unit: 'pnpm test:unit',
    full: ['pnpm test'],
  },
  calibrationFile: 'workflow-content/calibrations.md',
  provisioning: {
    repositories: [{ path: '.', provisionSteps: ['pnpm install'] }],
  },
  // Whole criteria the project injects beyond the core, each backed by its own gate.
  additionalCriteria: [],
  // Quick-mode disqualifiers added to the package's base list.
  quickDisqualifiers: [],
})
