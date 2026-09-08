import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import readability from 'text-readability'

const checksDir = path.dirname(new URL(import.meta.url).pathname)
const readingGradeCeiling = 6
const descriptionMaxCharacters = 1024
const emDashesPerFile = 2
const wordsThatAreNotSkillNames = new Set(['same', 'new', 'right', 'wrong', 'whole', 'first', 'last', 'other', 'generic', 'live', 'one', 'each', 'every', 'this', 'that', 'next', 'previous', 'existing', 'current', 'missing', 'correct', 'matching', 'relevant', 'loaded', 'installed', 'manual', 'package', 'project', 'consuming', 'shared', 'whole', 'entire', 'original', 'old', 'full', 'wider', 'broader', 'narrower', 'smaller', 'larger', 'bigger'])
const properNouns = new Set(['Vale', 'GitHub', 'Kysely', 'Claude', 'Biome', 'Playwright', 'Postgres', 'PostgreSQL', 'React', 'Remix', 'Vitest', 'Zod', 'Discord', 'Slack', 'Google', 'Linear', 'Notion', 'Docker', 'Node', 'TypeScript', 'JavaScript', 'Python', 'Anthropic', 'Seasoned', 'Graphile', 'Worker', 'Title', 'Case', 'Definition', 'Done', 'Map', 'Set'])

const findRoot = (from: string): string => {
  let dir = from
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'node_modules', '.bin', 'vale'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('No node_modules/.bin/vale above ' + from)
}
const root = findRoot(checksDir)
const bin = (name: string) => path.join(root, 'node_modules', '.bin', name)

const files = process.argv.slice(2).map((f) => path.resolve(f))
if (files.length === 0) {
  console.error('usage: node check.ts <markdown files>')
  process.exit(2)
}

type Level = 'error' | 'warning' | 'suggestion'
type Finding = { file: string; line: number; level: Level; rule: string; message: string }
type ValeAlert = { Line: number; Severity: Level; Check: string; Message: string }
type Duplicate = { lines: number; firstFile: { name: string; start: number }; secondFile: { name: string; start: number } }

const findings: Finding[] = []
const report = (file: string, line: number, level: Level, rule: string, message: string) =>
  findings.push({ file, line, level, rule, message })

const skillFolders = () => {
  const names = new Set<string>()
  for (const dir of ['.claude/skills', 'content/skills']) {
    const full = path.join(root, dir)
    if (existsSync(full)) for (const name of readdirSync(full)) names.add(name)
  }
  for (const file of files)
    if (path.basename(file) === 'SKILL.md') names.add(path.basename(path.dirname(file)))
  return names
}
const roster = skillFolders()

const splitFrontMatter = (text: string) => {
  if (!text.startsWith('---\n')) return { frontMatter: null, body: text, bodyStartLine: 1 }
  const end = text.indexOf('\n---\n', 4)
  if (end === -1) return { frontMatter: null, body: text, bodyStartLine: 1 }
  const frontMatter = text.slice(4, end)
  return {
    frontMatter,
    body: text.slice(end + 5),
    bodyStartLine: frontMatter.split('\n').length + 3,
  }
}

const frontMatterField = (frontMatter: string, key: string) => {
  const lines = frontMatter.split('\n')
  const index = lines.findIndex((l) => l.startsWith(key + ':'))
  if (index === -1) return null
  let value = (lines[index] ?? '').slice(key.length + 1).trim()
  if (value === '>' || value === '|' || value === '') {
    const rest = []
    for (let i = index + 1; i < lines.length && /^\s+\S/.test(lines[i] ?? ''); i++) rest.push((lines[i] ?? '').trim())
    value = rest.join(' ')
  }
  return { value, line: index + 2 }
}

const prose = (body: string) => {
  const kept: string[] = []
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^\s*(#|\||\[|-{3,})/.test(line)) continue
    const cleaned = line
      .replace(/^\s*(\d+\.|-)\s+/, '')
      .replace(/\*\*/g, '')
      .replace(/`[^`]*`/g, 'x')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim()
    if (!cleaned) continue
    kept.push(/[.!?]$/.test(cleaned) ? cleaned : cleaned + '.')
  }
  return kept.join(' ')
}

const grade = (text: string) => Number(readability.fleschKincaidGrade(text).toFixed(1))
const countEmDashes = (text: string) => (text.match(/—/g) ?? []).length

const blankQuotedMentions = (text: string) =>
  text.replace(/["\u201c]([^"\u201c\u201d\n]*)["\u201d]/g, (_match: string, inside: string) => '"' + ' '.repeat(inside.length) + '"')

const endSentencesAfterFileNames = (text: string) => text.replace(/\.([a-z]{1,4})(?=[.!?](\s|$))/g, '-$1')

const valeOverText = (text: string): ValeAlert[] => {
  const run = spawnSync(bin('vale'), ['--config', path.join(checksDir, '.vale.ini'), '--ext=.md', '--output=JSON'], {
    input: endSentencesAfterFileNames(blankQuotedMentions(text)),
    encoding: 'utf8',
  })
  const parsed: Record<string, ValeAlert[]> = run.stdout.trim() ? JSON.parse(run.stdout) : {}
  return Object.values(parsed).flat()
}

const identifierLike = (word: string) => /[`._\-/()\d]/.test(word) || /[a-z][A-Z]/.test(word) || /^[A-Z]{2,}$/.test(word)

const checkHeading = (file: string, lineNumber: number, heading: string) => {
  const words = heading.replace(/`[^`]*`/g, '`code`').split(/\s+/).filter(Boolean)
  if (/^\d+[.)]$/.test(words[0] ?? '')) words.shift()
  const first = words[0]
  if (first && /^[a-z]/.test(first) && !identifierLike(first))
    report(file, lineNumber, 'error', 'heading-case', `"${heading}" starts with a lowercase word. Headings start with a capital, and an identifier used as a heading goes in backticks.`)
  for (const word of words.slice(1)) {
    const bare = word.replace(/^[("]+|[):,."]+$/g, '')
    if (/^[A-Z][a-z]/.test(bare) && !identifierLike(bare) && !properNouns.has(bare))
      report(file, lineNumber, 'error', 'heading-case', `"${heading}" is in Title Case. Write it in sentence case.`)
  }
}

const checkFile = (file: string) => {
  const text = readFileSync(file, 'utf8')
  const { frontMatter, body, bodyStartLine } = splitFrontMatter(text)
  const isSkill = path.basename(file) === 'SKILL.md'

  if (frontMatter !== null) {
    if (countEmDashes(frontMatter) > 0)
      report(file, 2, 'error', 'front-matter-dashes', 'The front matter has an em dash. Front matter carries none.')
    const name = frontMatterField(frontMatter, 'name')
    if (isSkill) {
      const folder = path.basename(path.dirname(file))
      if (!name) report(file, 2, 'error', 'name', 'The skill has no name.')
      else {
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name.value) || name.value.length > 64)
          report(file, name.line, 'error', 'name', `"${name.value}" must be 1 to 64 lowercase letters, digits, and single hyphens.`)
        if (name.value !== folder)
          report(file, name.line, 'error', 'name', `The name "${name.value}" does not match the folder "${folder}".`)
      }
    }
    const description = frontMatterField(frontMatter, 'description')
    if (isSkill && !description) report(file, 2, 'error', 'description', 'The skill has no description.')
    if (description) {
      if (description.value.length > descriptionMaxCharacters)
        report(file, description.line, 'error', 'description-length', `The description is ${description.value.length} characters. The cap is ${descriptionMaxCharacters}.`)
      const descriptionGrade = grade(description.value)
      if (descriptionGrade > readingGradeCeiling)
        report(file, description.line, 'error', 'description-grade', `The description reads at grade ${descriptionGrade}. The ceiling is ${readingGradeCeiling}. Shorten its sentences.`)
      for (const alert of valeOverText(description.value))
        report(file, description.line, alert.Severity, alert.Check, alert.Message)
    }
  } else if (isSkill) {
    report(file, 1, 'error', 'front-matter', 'A skill starts with front matter.')
  }

  const dashes = countEmDashes(body)
  if (dashes > emDashesPerFile)
    report(file, bodyStartLine, 'error', 'dashes', `The file has ${dashes} em dashes. The ration is ${emDashesPerFile}.`)

  const bodyProse = prose(body)
  if (bodyProse) {
    const bodyGrade = grade(bodyProse)
    if (bodyGrade > readingGradeCeiling)
      report(file, bodyStartLine, 'error', 'grade', `The file reads at grade ${bodyGrade}. The ceiling is ${readingGradeCeiling}. Shorten its sentences.`)
  }

  let inFence = false
  body.split('\n').forEach((line, index) => {
    const lineNumber = bodyStartLine + index
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) return
    const heading = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/)
    if (heading) checkHeading(file, lineNumber, heading[1] ?? '')
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1] ?? ''
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const resolved = path.resolve(path.dirname(file), target.split('#')[0] ?? '')
      if (!existsSync(resolved))
        report(file, lineNumber, 'error', 'link', `The link "${target}" points at a file that does not exist.`)
    }
    for (const match of blankQuotedMentions(line).matchAll(/\bthe ([a-z][a-z0-9-]*) skill\b/g)) {
      const name = match[1] ?? ''
      if (!roster.has(name) && !wordsThatAreNotSkillNames.has(name))
        report(file, lineNumber, 'error', 'skill-name', `"the ${name} skill" is not a name in the roster. Name the skill, or reword so it does not read as one.`)
    }
  })

  for (const alert of valeOverText(text))
    report(file, alert.Line, alert.Severity, alert.Check, alert.Message)
}

for (const file of files) checkFile(file)

const spellingDir = mkdtempSync(path.join(tmpdir(), 'cspell-'))
const spellingConfig = path.join(spellingDir, 'cspell.json')
writeFileSync(spellingConfig, JSON.stringify({ import: [path.join(checksDir, 'cspell.json')], words: [...roster] }))
const spelling = spawnSync(bin('cspell'), ['lint', '--no-progress', '--no-summary', '--no-color', '--config', spellingConfig, ...files], { encoding: 'utf8' })
rmSync(spellingDir, { recursive: true, force: true })
for (const line of (spelling.stdout + spelling.stderr).split('\n')) {
  const match = line.match(/^(.+?):(\d+):\d+ - Unknown word \((.+)\)/)
  if (match) report(path.resolve(match[1] ?? ''), Number(match[2]), 'error', 'spelling', `"${match[3]}" is not a word the dictionary knows. Fix the spelling. If it is a real term, add it to cspell.json and say so in the pull request.`)
}

if (files.length > 1) {
  const out = mkdtempSync(path.join(tmpdir(), 'jscpd-'))
  spawnSync(bin('jscpd'), ['--min-tokens', '50', '--format', 'markdown', '--reporters', 'json', '--output', out, '--silent', ...files], { encoding: 'utf8' })
  const reportPath = path.join(out, 'jscpd-report.json')
  if (existsSync(reportPath)) {
    const duplicates: Duplicate[] = JSON.parse(readFileSync(reportPath, 'utf8')).duplicates ?? []
    for (const d of duplicates)
      report(d.firstFile.name, d.firstFile.start, 'error', 'duplicate', `${d.lines} lines repeat ${path.relative(root, d.secondFile.name)}:${d.secondFile.start}. One home per rule.`)
  }
  rmSync(out, { recursive: true, force: true })
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
for (const f of findings)
  console.log(`${path.relative(process.cwd(), f.file)}:${f.line} ${f.level} ${f.rule}: ${f.message}`)
const count = (level: Level) => findings.filter((f) => f.level === level).length
console.log(`\n${count('error')} errors, ${count('warning')} warnings, ${count('suggestion')} suggestions`)
process.exit(count('error') > 0 ? 1 : 0)
