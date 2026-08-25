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
  additionalCriteria: [
    {
      text: 'A task is not done if it changed a command, a flag, a configuration key, an export, the generated output, the managed footprint, or the way of working itself without the documentation saying so in the same task: `docs/reference/` carries the names, and the pages above it carry the practice.',
      backedBy:
        'the reference enumeration test in `pnpm test:unit` for the names, and the `pr-review` conventions pass for the prose',
      quickDisposition: 'kept',
    },
  ],
  // Quick-mode disqualifiers added to the package's base list.
  quickDisqualifiers: [],
})
