import type { SeasonedSkillsConfig } from './types.js'

/**
 * The configuration schema as a value nothing has to parse to read: every key
 * a `seasoned-skills.config.ts` may carry, at full depth, enumerable at
 * runtime. The types stay the schema — this manifest is typed from them, so
 * adding, renaming, or removing a key in `types.ts` stops this file compiling
 * until the manifest matches.
 *
 * `null` marks a key nothing nests inside; an object holds the keys below it;
 * a one-element array holds the keys of a list's entries, the same shape the
 * configuration file itself is written in.
 */

/** Every key a type carries, optional ones included, across a union's members. */
type KeyNames<Type> = Type extends unknown ? keyof Required<Type> : never

/** The type behind one key, taken from whichever union member declares it. */
type ValueAt<Type, Key extends PropertyKey> = Type extends unknown
  ? Key extends keyof Type
    ? Required<Type>[Key]
    : never
  : never

type KeyGroup<Type> = {
  readonly [Key in KeyNames<Type>]: KeyManifest<ValueAt<Type, Key>>
}

/**
 * The manifest shape one key's type demands. A list of objects describes its
 * entries; an object describes its keys; a string, a number, a list of
 * strings, or an open map of names to values nests nothing and reads `null`.
 */
type KeyManifest<Value> = [NonNullable<Value>] extends [readonly (infer Entry)[]]
  ? [Entry] extends [object]
    ? [KeyGroup<Entry>]
    : null
  : [NonNullable<Value>] extends [object]
    ? string extends keyof NonNullable<Value>
      ? null
      : KeyGroup<NonNullable<Value>>
    : null

export const CONFIGURATION_KEYS: KeyManifest<SeasonedSkillsConfig> = {
  projectName: null,
  contentDir: null,
  mergeStrategy: null,
  agentMergesDuringGoal: null,
  outOfScopeFindings: null,
  release: {
    target: null,
    packages: [{ name: null, tagPrefix: null, publishCommand: null }],
  },
  gates: {
    lint: null,
    typecheck: null,
    unit: null,
    relatedSpecs: null,
    full: null,
  },
  calibrationFile: null,
  webSurface: { coverageRegister: null, excusedSurfaces: null },
  demoSeed: { seedManifest: null },
  machineSurface: { parityStandard: null, exceptionRegister: null },
  stack: { name: null, databaseMutability: null },
  provisioning: {
    repositories: [
      {
        path: null,
        provisionSteps: null,
        seedCommand: null,
        migrateCommand: null,
        databases: [{ name: null, derivedPatterns: null, envKey: null, seeded: null }],
        envFile: null,
        envFiles: [
          { path: null, databases: null, ports: null, cacheStore: null, extra: null },
        ],
        portBases: null,
        portBlocks: null,
        templateCaching: null,
        cacheStoreIndex: null,
        cacheStoreEnvKeys: null,
        migrationSources: null,
        seedSources: null,
      },
    ],
    services: null,
    serviceStartCommand: null,
    databasePrefix: null,
    seedDateTimezone: null,
    laneProcessCommands: null,
  },
  additionalCriteria: [
    { text: null, backedBy: null, quickDisposition: null, quickText: null },
  ],
  quickDisqualifiers: null,
  machinePrerequisites: [{ binary: null, reason: null, hint: null }],
}

type ManifestNode = null | [ManifestGroup] | ManifestGroup
type ManifestGroup = { readonly [key: string]: ManifestNode }

/**
 * Every key path the configuration may carry, in declaration order, dotted
 * from the root — with `[]` after a key whose entries are objects, so
 * `provisioning.repositories[].databases[].name` names exactly one thing.
 */
export function configurationKeyPaths(): string[] {
  return keyPathsOf(CONFIGURATION_KEYS, '')
}

function keyPathsOf(group: ManifestGroup, prefix: string): string[] {
  return Object.entries(group).flatMap(([key, node]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (node === null) return [path]
    if (Array.isArray(node)) return [path, ...keyPathsOf(node[0], `${path}[]`)]
    return [path, ...keyPathsOf(node, path)]
  })
}
