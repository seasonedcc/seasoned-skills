---
name: skill-manager
description: Create, manage, and debug Claude Code Agent Skills. Use when creating new skills, debugging skill activation issues, writing SKILL.md files, managing skill structure, or learning about Claude Code skills. Helps with personal skills, project skills, YAML frontmatter, descriptions, and troubleshooting.
---

# Skill Manager

Create and manage Agent Skills for Claude Code. Skills are modular capabilities packaged as folders containing instructions, scripts, and resources.

**Skills are model-invoked**: Claude autonomously decides when to use them based on the request and the skill's description — unlike slash commands, which the user invokes explicitly.

## Progressive disclosure

Skills load in three levels, which is what keeps context lean:

1. **Metadata (name + description)** — always in context for every skill; drives discovery.
2. **SKILL.md body** — loaded only when the skill triggers. Keep it under ~5k words, lean, essential procedural instructions only.
3. **Bundled resources** — `scripts/` may execute without loading into context; `references/` load into context when needed; `assets/` are used in output and never loaded.

## Locations

- **Personal**: `~/.claude/skills/<name>/` — individual workflows, experiments.
- **Project**: `.claude/skills/<name>/` — team conventions, checked into git, shared automatically.
- **Plugin**: skills can also ship inside Claude Code plugins.

## SKILL.md format

Every skill is a `SKILL.md` with YAML frontmatter — `---` on line 1, closing `---` before the body, no tabs:

```yaml
---
name: my-skill-name
description: What it does + specific actions + "Use when" + trigger scenarios/keywords.
---
```

- **name** (required): kebab-case, and EXACTLY the skill's folder name.
- **description** (required): the most critical field — it is all Claude sees when deciding whether to load the skill. Formula: **[What it does] + [Specific actions] + "Use when" + [triggers]**. Write in third person, imperative form (`"Use when…"`, never `"Use this skill when…"`). Vague descriptions ("Helps with documents") and missing triggers are the top cause of skills not activating. Keep descriptions distinct across skills to prevent activation conflicts.
- **allowed-tools** (optional): comma-separated tool list to restrict capabilities (e.g. `Read, Grep, Glob` for a read-only skill). Omit for normal permission behavior.

## Writing style

- Imperative/infinitive, verb-first: "Run the command", "To accomplish X, do Y" — never second person ("You should…").
- Objective, instructional language; no conversational or persuasive prose.
- **Every instruction is a standalone statement of current policy.** Never write a delta against a prior state ("previously X, now Y", "everything that used to be Z") — the future reader has none of the history that made the delta meaningful.
- **No duplication**: information lives in either SKILL.md or a resource file, never both. Move detailed schemas, API docs, and long examples to `references/`; for reference files over ~10k words, include grep patterns in SKILL.md so Claude can find sections without reading the whole file.

## Resource directories

- `scripts/` — executable code for operations that are rewritten repeatedly or need deterministic reliability. Token-efficient: they can run without being loaded into context.
- `references/` — documentation loaded into context on demand: schemas, API specs, policies, detailed guides.
- `assets/` — files used in the output (templates, images, boilerplate), never loaded into context.

Single-file skills (just SKILL.md) suit simple, focused capabilities; add resource directories only when a workflow genuinely needs them.

## Creating a skill

1. **Understand with concrete examples**: what should trigger it, and what would a user say? Conclude when the functionality is clear.
2. **Plan reusable resources**: for each example, ask what script, reference, or asset would remove repeated work.
3. **Create the structure**: `mkdir -p .claude/skills/<name>` (plus resource dirs as needed).
4. **Implement resources first, then SKILL.md**: the body answers three questions — what is this for, when to use it, how to use it — and references every resource.
5. **Test and iterate**: ask questions matching the description's triggers and confirm the skill activates and works; refine on real usage.

## Keep skills focused

One skill = one capability. "Document processing" is too broad — split by type or operation. When a skill accumulates a second concern, extract it.

## Troubleshooting

When a skill doesn't activate or work, check in order:

1. **Location**: `ls .claude/skills/<name>/SKILL.md` (or `~/.claude/skills/…`) — the folder name must equal the frontmatter `name`.
2. **YAML syntax**: opening `---` on line 1, closing `---` before content, no tabs, `name` and `description` present.
3. **Description specificity**: does it say what, when, and include the trigger words the user actually said? Is it distinct from sibling skills?
4. **Explicit test**: ask a question that verbatim-matches a description trigger.
5. **Debug mode**: `claude --debug` shows skill loading errors.

If a skill activates but fails: list required packages in the description (Claude installs dependencies when needed), `chmod +x` bundled scripts, and use forward-slash paths.
