/**
 * The consuming project's configuration, loaded from `seasoned-skills.config.ts`
 * at the repository root. The package exports these types so a project's editor
 * flags a bad option before the tool ever runs.
 *
 * This is the skeleton; the full option surface lands with the config layer.
 */
export interface SeasonedSkillsConfig {
  /** How the project refers to itself in generated instructions. */
  projectName: string
}
