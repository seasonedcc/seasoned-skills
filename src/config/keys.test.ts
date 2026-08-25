import { describe, expect, it } from 'vitest'
import { configurationKeyPaths, type KeyManifest, keyPathsOf } from './keys.js'

/**
 * The manifest's drift guard is the compiler, so these probes are type-level:
 * each `@ts-expect-error` fails `pnpm tsc` the moment the manifest type stops
 * refusing the shape it names, and the expectation beside it shows what that
 * shape would do to the enumeration if the compiler let it through.
 */
interface ProbeEnvironmentFile {
  path: string
  ports: Record<string, number>
}

interface ProbeConfiguration {
  plainKey: string
  openMap: Record<string, string>
  group: ProbeEnvironmentFile
  groupList: ProbeEnvironmentFile[]
  unionWithGroup: string | ProbeEnvironmentFile
  listOfUnionsWithGroup: (string | ProbeEnvironmentFile)[]
}

const COMPLETE: KeyManifest<ProbeConfiguration> = {
  plainKey: null,
  openMap: null,
  group: { path: null, ports: null },
  groupList: [{ path: null, ports: null }],
  unionWithGroup: { path: null, ports: null },
  listOfUnionsWithGroup: [{ path: null, ports: null }],
}

describe('the manifest a configuration type demands', () => {
  it('reaches the keys beneath a group, a list, and a union', () => {
    expect(keyPathsOf(COMPLETE)).toEqual([
      'plainKey',
      'openMap',
      'group',
      'group.path',
      'group.ports',
      'groupList',
      'groupList[].path',
      'groupList[].ports',
      'unionWithGroup',
      'unionWithGroup.path',
      'unionWithGroup.ports',
      'listOfUnionsWithGroup',
      'listOfUnionsWithGroup[].path',
      'listOfUnionsWithGroup[].ports',
    ])
  })

  it('refuses a union whose object member would nest nothing', () => {
    const collapsed: KeyManifest<ProbeConfiguration> = {
      ...COMPLETE,
      // @ts-expect-error the object member still carries keys of its own
      unionWithGroup: null,
    }
    expect(keyPathsOf(collapsed)).not.toContain('unionWithGroup.path')
  })

  it('refuses a list of unions whose entries would nest nothing', () => {
    const collapsed: KeyManifest<ProbeConfiguration> = {
      ...COMPLETE,
      // @ts-expect-error an entry's object member still carries keys of its own
      listOfUnionsWithGroup: null,
    }
    expect(keyPathsOf(collapsed)).not.toContain('listOfUnionsWithGroup[].path')
  })

  it('refuses a group written as though it nested nothing', () => {
    const collapsed: KeyManifest<ProbeConfiguration> = {
      ...COMPLETE,
      // @ts-expect-error an object key demands the keys below it
      group: null,
    }
    expect(keyPathsOf(collapsed)).not.toContain('group.path')
  })

  it('refuses a key the configuration types do not carry', () => {
    const stray: KeyManifest<ProbeConfiguration> = {
      ...COMPLETE,
      // @ts-expect-error nothing in the configuration types declares this key
      strayKey: null,
    }
    expect(keyPathsOf(stray)).toContain('strayKey')
  })

  it('refuses a manifest missing a key the configuration types carry', () => {
    // @ts-expect-error every key the types carry has to be listed
    const incomplete: KeyManifest<ProbeConfiguration> = {
      plainKey: null,
      group: { path: null, ports: null },
      groupList: [{ path: null, ports: null }],
      unionWithGroup: { path: null, ports: null },
      listOfUnionsWithGroup: [{ path: null, ports: null }],
    }
    expect(keyPathsOf(incomplete)).not.toContain('openMap')
  })
})

describe('configurationKeyPaths', () => {
  it('dots each key from the root, marking a list entry with []', () => {
    expect(configurationKeyPaths()).toContain(
      'provisioning.repositories[].databases[].name',
    )
    expect(configurationKeyPaths()).toContain('release.packages[].publishCommand')
  })
})
