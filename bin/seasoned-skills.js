#!/usr/bin/env node
// Committed launcher so the bin shim can be linked before dist/ exists —
// a fresh clone of this repo installs the package via `link:.`, and pnpm
// creates bin links before the prepare script has built dist/.
const printWarnings = process.listeners('warning')
const isSqliteExperimentalWarning = (warning) =>
  warning.name === 'ExperimentalWarning' && warning.message.startsWith('SQLite')
process.removeAllListeners('warning')
process.on('warning', (warning) => {
  if (isSqliteExperimentalWarning(warning)) return
  for (const print of printWarnings) print(warning)
})
import('../dist/cli/index.js')
