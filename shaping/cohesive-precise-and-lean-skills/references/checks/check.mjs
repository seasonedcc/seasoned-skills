#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import readability from 'text-readability'

const checksDir = path.dirname(new URL(import.meta.url).pathname)
const readingGradeCeiling = 6
const descriptionMaxCharacters = 1024
const emDashesPerFile = 2
const termsOfArt = ['orchestrator', 'lane', 'gate', 'ledger', 'roster', 'footprint']

const findRoot = (from) => {
  let dir = from
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'node_modules', '.bin', 'vale'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('No node_modules/.bin/vale above ' + from)
}
const root = findRoot(checksDir)
const bin = (name) => path.join(root, 'node_modules', '.bin', name)

const files = process.argv.slice(2).map((f) => path.resolve(f))
if (files.length === 0) {
  console.error('usage: node check.mjs <markdown files>')
  process.exit(2)
}

const findings = []
const report = (file, line, level, rule, message) =>
  findings.push({ file, line, level, rule, message })

const skillFolders = () => {
  const names = new Set()
  for (const dir of ['.claude/skills', 'content/skills']) {
    const full = path.join(root, dir)
    if (existsSync(full)) for (const name of readdirSync(full)) names.add(name)
  }
  for (const file of files)
    if (path.basename(file) === 'SKILL.md') names.add(path.basename(path.dirname(file)))
  return names
}
const roster = skillFolders()

const splitFrontMatter = (text) => {
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

const frontMatterField = (frontMatter, key) => {
  const lines = frontMatter.split('\n')
  const index = lines.findIndex((l) => l.startsWith(key + ':'))
  if (index === -1) return null
  let value = lines[index].slice(key.length + 1).trim()
  if (value === '>' || value === '|' || value === '') {
    const rest = []
    for (let i = index + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) rest.push(lines[i].trim())
    value = rest.join(' ')
  }
  return { value, line: index + 2 }
}

const prose = (body) => {
  const kept = []
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

const grade = (text) => Number(readability.fleschKincaidGrade(text).toFixed(1))
const countEmDashes = (text) => (text.match(/—/g) ?? []).length

const valeOverText = (text) => {
  const run = spawnSync(bin('vale'), ['--config', path.join(checksDir, '.vale.ini'), '--ext=.md', '--output=JSON'], {
    input: text,
    encoding: 'utf8',
  })
  const parsed = run.stdout.trim() ? JSON.parse(run.stdout) : {}
  return Object.values(parsed).flat()
}

const valeOverFile = (file) => {
  const run = spawnSync(bin('vale'), ['--config', path.join(checksDir, '.vale.ini'), '--output=JSON', file], {
    encoding: 'utf8',
  })
  const parsed = run.stdout.trim() ? JSON.parse(run.stdout) : {}
  return Object.values(parsed).flat()
}

const checkFile = (file) => {
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

  body.split('\n').forEach((line, index) => {
    const lineNumber = bodyStartLine + index
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1]
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const resolved = path.resolve(path.dirname(file), target.split('#')[0])
      if (!existsSync(resolved))
        report(file, lineNumber, 'error', 'link', `The link "${target}" points at a file that does not exist.`)
    }
    for (const match of line.matchAll(/\bthe ([a-z][a-z0-9-]*) skill\b/g)) {
      if (!roster.has(match[1]))
        report(file, lineNumber, 'warning', 'skill-name', `"the ${match[1]} skill" is not a name in the roster. Skills go by their real names.`)
    }
  })

  const sentences = bodyProse.split(/(?<=[.!?])\s+(?=[A-Z"])/)
  for (const term of termsOfArt) {
    const first = sentences.find((s) => new RegExp(`\\b${term}s?\\b`, 'i').test(s))
    if (!first) continue
    const defined = /[:(]| is | are | means |, the |such as/.test(first)
    if (!defined)
      report(file, bodyStartLine, 'suggestion', 'term', `"${term}" first appears without a definition beside it: "${first.slice(0, 80)}"`)
  }

  for (const alert of valeOverFile(file))
    report(file, alert.Line, alert.Severity, alert.Check, alert.Message)
}

for (const file of files) checkFile(file)

const spelling = spawnSync(bin('cspell'), ['lint', '--no-progress', '--no-summary', '--no-color', '--config', path.join(checksDir, 'cspell.json'), ...files], { encoding: 'utf8' })
for (const line of (spelling.stdout + spelling.stderr).split('\n')) {
  const match = line.match(/^(.+?):(\d+):\d+ - Unknown word \((.+)\)/)
  if (match) report(path.resolve(match[1]), Number(match[2]), 'error', 'spelling', `"${match[3]}" is not a word the dictionary knows.`)
}

if (files.length > 1) {
  const out = mkdtempSync(path.join(tmpdir(), 'jscpd-'))
  spawnSync(bin('jscpd'), ['--min-tokens', '50', '--format', 'markdown', '--reporters', 'json', '--output', out, '--silent', ...files], { encoding: 'utf8' })
  const reportPath = path.join(out, 'jscpd-report.json')
  if (existsSync(reportPath)) {
    for (const d of JSON.parse(readFileSync(reportPath, 'utf8')).duplicates ?? [])
      report(d.firstFile.name, d.firstFile.start, 'error', 'duplicate', `${d.lines} lines repeat ${path.relative(root, d.secondFile.name)}:${d.secondFile.start}. One home per rule.`)
  }
  rmSync(out, { recursive: true, force: true })
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
for (const f of findings)
  console.log(`${path.relative(process.cwd(), f.file)}:${f.line} ${f.level} ${f.rule}: ${f.message}`)
const count = (level) => findings.filter((f) => f.level === level).length
console.log(`\n${count('error')} errors, ${count('warning')} warnings, ${count('suggestion')} suggestions`)
process.exit(count('error') > 0 ? 1 : 0)
