#!/usr/bin/env node
// Committed launcher so the bin shim can be linked before dist/ exists —
// a fresh clone of this repo installs the package via `link:.`, and pnpm
// creates bin links before the prepare script has built dist/.
import('../dist/cli/index.js')
