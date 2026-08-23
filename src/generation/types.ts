import type { SeasonedSkillsConfig } from '../config/types.js'

/** One file the generation produces, path relative to the project root. */
export interface GeneratedFile {
  path: string
  /** Woven text, or raw bytes for verbatim-materialized assets (fonts, audio). */
  contents: string | Uint8Array
  /** Set for scripts that must be executable when materialized. */
  executable?: boolean
}

/** Everything a composition function may read. */
export interface GenerationContext {
  config: SeasonedSkillsConfig
  content: ProjectContent
}

/**
 * The project-owned content the configuration points at: one file per generated
 * skill plus one for the doctrine layer. Every file a generated skill needs is
 * mandatory — sync fails loud on an absent one.
 */
export interface ProjectContent {
  /** Keyed by content file name without extension ('doctrine', 'orchestration', …). */
  files: Map<string, ContentFile>
}

export interface ContentFile {
  /**
   * The project's own trigger vocabulary, woven into the generated skill's
   * one-line description so the skill activates for the phrases the project
   * actually uses.
   */
  triggers?: string
  /** The body woven in as the project-specifics section at the skill's anchor. */
  body: string
}
