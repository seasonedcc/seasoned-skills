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
 * The object a value's type can hold, with the primitives a union puts beside
 * it dropped. A key typed `string | EnvFile` still nests the env file's keys,
 * so the union's object member is what the manifest has to describe.
 */
type ObjectPart<Value> = Extract<NonNullable<Value>, object>

/**
 * The manifest shape one key's type demands. A list of objects describes its
 * entries; an object describes its keys; a string, a number, a list of
 * strings, or an open map of names to values nests nothing and reads `null`.
 */
export type KeyManifest<Value> = [ObjectPart<Value>] extends [never]
  ? null
  : [ObjectPart<Value>] extends [readonly (infer Entry)[]]
    ? [ObjectPart<Entry>] extends [never]
      ? null
      : [KeyGroup<ObjectPart<Entry>>]
    : string extends keyof ObjectPart<Value>
      ? null
      : KeyGroup<ObjectPart<Value>>

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

export type ManifestNode = null | [ManifestGroup] | ManifestGroup
export type ManifestGroup = { readonly [key: string]: ManifestNode }

/**
 * Every key path the configuration may carry, in declaration order, dotted
 * from the root — with `[]` after a key whose entries are objects, so
 * `provisioning.repositories[].databases[].name` names exactly one thing.
 */
export function configurationKeyPaths(): string[] {
  return keyPathsOf(CONFIGURATION_KEYS)
}

export function keyPathsOf(group: ManifestGroup, prefix = ''): string[] {
  return Object.entries(group).flatMap(([key, node]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (node === null) return [path]
    if (Array.isArray(node)) return [path, ...keyPathsOf(node[0], `${path}[]`)]
    return [path, ...keyPathsOf(node, path)]
  })
}
