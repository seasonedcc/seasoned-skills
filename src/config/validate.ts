import type { SeasonedSkillsConfig } from './types.js'

/**
 * Structural validation of a loaded configuration. TypeScript catches most
 * mistakes in the editor; this catches the file that was edited without it.
 * Returns every problem at once — sync reports complete errors, never the
 * first one it hit.
 */
export function validateConfig(value: unknown): string[] {
  const issues: string[] = []
  if (typeof value !== 'object' || value === null) {
    return ['the configuration must export an object']
  }
  const config = value as Partial<SeasonedSkillsConfig>

  if (!isNonEmptyString(config.projectName)) {
    issues.push('projectName must be a non-empty string')
  }
  if (!isNonEmptyString(config.contentDir)) {
    issues.push('contentDir must be a non-empty string')
  }
  if (config.mergeStrategy !== 'merge-commit' && config.mergeStrategy !== 'squash') {
    issues.push("mergeStrategy must be 'merge-commit' or 'squash'")
  }
  if (
    config.outOfScopeFindings !== undefined &&
    config.outOfScopeFindings !== 'bank' &&
    config.outOfScopeFindings !== 'autofix'
  ) {
    issues.push("outOfScopeFindings must be 'bank' or 'autofix' when present")
  }
  if (typeof config.release !== 'object' || config.release === null) {
    issues.push('release must be declared')
  } else if (
    config.release.target !== 'deployed-product' &&
    config.release.target !== 'published-package'
  ) {
    issues.push("release.target must be 'deployed-product' or 'published-package'")
  } else if (config.release.target === 'published-package') {
    if (!Array.isArray(config.release.packages) || config.release.packages.length === 0) {
      issues.push('release.packages must list at least one package')
    }
  }
  if (typeof config.gates !== 'object' || config.gates === null) {
    issues.push('gates must be declared')
  }
  if (!isNonEmptyString(config.calibrationFile)) {
    issues.push('calibrationFile must be a non-empty string')
  }
  if (config.webSurface !== undefined) {
    if (!isNonEmptyString(config.webSurface?.coverageRegister)) {
      issues.push('webSurface.coverageRegister must be a non-empty string')
    }
    if (!isNonEmptyString(config.webSurface?.excusedSurfaces)) {
      issues.push('webSurface.excusedSurfaces must be a non-empty string')
    }
  }
  if (config.demoSeed !== undefined && !isNonEmptyString(config.demoSeed?.seedManifest)) {
    issues.push('demoSeed.seedManifest must be a non-empty string')
  }
  if (config.machineSurface !== undefined) {
    if (!isNonEmptyString(config.machineSurface?.parityStandard)) {
      issues.push('machineSurface.parityStandard must be a non-empty string')
    }
    if (!isNonEmptyString(config.machineSurface?.exceptionRegister)) {
      issues.push('machineSurface.exceptionRegister must be a non-empty string')
    }
  }
  if (config.stack !== undefined) {
    if (config.stack?.name !== 'react-router-kysely') {
      issues.push("stack.name must be 'react-router-kysely'")
    }
    if (
      config.stack?.databaseMutability !== 'append-only' &&
      config.stack?.databaseMutability !== 'mutable-when-not-derivable'
    ) {
      issues.push(
        "stack.databaseMutability must be 'append-only' or 'mutable-when-not-derivable'",
      )
    }
  }
  for (const [index, criterion] of (config.additionalCriteria ?? []).entries()) {
    if (!isNonEmptyString(criterion?.text)) {
      issues.push(`additionalCriteria[${index}].text must be a non-empty string`)
    }
    if (!isNonEmptyString(criterion?.backedBy)) {
      issues.push(`additionalCriteria[${index}].backedBy must be a non-empty string`)
    }
    if (
      !['kept', 'reduced', 'excluded'].includes(criterion?.quickDisposition as string)
    ) {
      issues.push(
        `additionalCriteria[${index}].quickDisposition must be 'kept', 'reduced', or 'excluded'`,
      )
    }
    if (
      criterion?.quickDisposition === 'reduced' &&
      !isNonEmptyString(criterion.quickText)
    ) {
      issues.push(
        `additionalCriteria[${index}].quickText is required when the disposition is 'reduced'`,
      )
    }
  }
  for (const [index, prerequisite] of (config.machinePrerequisites ?? []).entries()) {
    if (!isNonEmptyString(prerequisite?.binary)) {
      issues.push(`machinePrerequisites[${index}].binary must be a non-empty string`)
    }
    if (!isNonEmptyString(prerequisite?.reason)) {
      issues.push(`machinePrerequisites[${index}].reason must be a non-empty string`)
    }
    if (!isNonEmptyString(prerequisite?.hint)) {
      issues.push(`machinePrerequisites[${index}].hint must be a non-empty string`)
    }
  }
  return issues
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
