/**
 * The unified worktree-provisioning implementation, driven entirely by the
 * resource table in the project's configuration (`ProvisioningConfig`). The
 * CLI layer registers these as subcommands; nothing here parses argv.
 */
export {
  type LaneAllocation,
  type LaneProcess,
  type PortPlan,
  type ResolvedProvisioning,
  type ResolvedRepository,
  resolveProvisioning,
  sessionEndCleansUpProcesses,
  type TemplateFingerprint,
} from './common.js'
export {
  type LaneProcessOptions,
  listLaneProcesses,
  type SweptProcess,
  sweepLaneProcesses,
} from './processes.js'
export {
  type LaneWorktree,
  type ProvisionedDatabase,
  type ProvisionedRepository,
  type ProvisionOptions,
  type ProvisionResult,
  provisionLane,
} from './setup.js'
export {
  type TeardownOptions,
  type TeardownResult,
  teardownLane,
} from './teardown.js'
