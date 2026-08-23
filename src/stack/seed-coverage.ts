/**
 * The demo-seed criterion's deriving checker for the packaged stack: the
 * denominator of user-facing surfaces is derived from the stack's own route
 * enumeration, never maintained by hand. A project's seed-manifest suite
 * feeds its route config and its claimed surfaces through this module and
 * fails while any route is neither claimed nor deliberately excluded — and
 * while any claim points at a route that no longer exists, so the manifest
 * cannot drift into fiction.
 */

/** The data shape `@react-router/dev/routes` helpers produce. */
export interface RouteConfigEntry {
  file: string
  path?: string
  index?: boolean
  children?: RouteConfigEntry[]
}

export interface SeedCoverageInput {
  /** The project's route config — the default export of its routes module. */
  routes: RouteConfigEntry[]
  /** Route ids the seed manifest claims (seeded or declared unseedable). */
  claims: Iterable<string>
  /** Route-id prefixes deliberately outside the demo surface, e.g. internal tooling. */
  excludedPrefixes?: string[]
}

export interface SeedCoverageReport {
  /** Every enumerated surface, for the suite's tally output. */
  surfaces: string[]
  /** Surfaces no claim covers — each one fails the gate. */
  unclaimed: string[]
  /** Claims pointing at surfaces the route config no longer declares. */
  unknownClaims: string[]
}

/**
 * A route's id is its module path with the extension stripped — the same
 * derivation the stack's E2E coverage gates use, so one vocabulary names a
 * surface everywhere.
 */
export function routeId(file: string): string {
  return file.replace(/\.[^./]+$/, '')
}

/**
 * Enumerates the leaf surfaces of a route config. An entry with children is
 * a layout — its own module renders chrome around an outlet, not a surface a
 * seed can put demo state behind — so only childless entries count.
 */
export function enumerateSurfaces(routes: RouteConfigEntry[]): string[] {
  const surfaces = new Set<string>()
  const walk = (entries: RouteConfigEntry[]) => {
    for (const entry of entries) {
      if (entry.children && entry.children.length > 0) {
        walk(entry.children)
        continue
      }
      surfaces.add(routeId(entry.file))
    }
  }
  walk(routes)
  return [...surfaces].sort()
}

export function seedCoverage({
  routes,
  claims,
  excludedPrefixes = [],
}: SeedCoverageInput): SeedCoverageReport {
  const surfaces = enumerateSurfaces(routes)
  const surfaceSet = new Set(surfaces)
  const claimSet = new Set([...claims].map(routeId))

  const excluded = (surface: string) =>
    excludedPrefixes.some((prefix) => surface.startsWith(prefix))

  const unclaimed = surfaces.filter(
    (surface) => !claimSet.has(surface) && !excluded(surface),
  )
  const unknownClaims = [...claimSet].filter((claim) => !surfaceSet.has(claim)).sort()

  return { surfaces, unclaimed, unknownClaims }
}

/**
 * The assertion a seed-manifest suite makes: an empty list, or a message per
 * failure naming the fix.
 */
export function seedCoverageFailures(report: SeedCoverageReport): string[] {
  return [
    ...report.unclaimed.map(
      (surface) =>
        `${surface}: no seed-manifest entry claims this surface — seed its demo state or declare it unseedable with a written reason`,
    ),
    ...report.unknownClaims.map(
      (claim) =>
        `${claim}: the seed manifest claims a surface the route config no longer declares — remove or repoint the entry`,
    ),
  ]
}
