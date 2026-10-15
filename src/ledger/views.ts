import type { Entry, SearchResults } from './record.js'

/**
 * Everything the ledger prints. Times are stored in UTC and shown in the
 * machine's local time: the full stamp with its offset wherever one entry is
 * printed, and in a list the time of day for today's entries and the date and
 * time for older ones. Shortened text is marked with an ellipsis where it
 * was cut and is never reworded; the whole entry is one `show` away.
 */

interface InForce {
  decisions: Entry[]
  progress: { entries: Entry[]; total: number }
  findings: { inForce: number; total: number }
  now: Date
}

const HOOK_BUDGET = 9500

const HOOK_PROGRESS_CHARACTERS = 200

const ELLIPSIS = '…'

const CONTINUATION = '    '

function twoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}

function localTimeOfDay(date: Date) {
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
}

function fullStamp(date: Date) {
  const offset = -date.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const hours = twoDigits(Math.floor(Math.abs(offset) / 60))
  const minutes = twoDigits(Math.abs(offset) % 60)
  return `${localDate(date)} ${localTimeOfDay(date)}:${twoDigits(date.getSeconds())} ${sign}${hours}:${minutes}`
}

function listTime(date: Date, now: Date) {
  return localDate(date) === localDate(now)
    ? localTimeOfDay(date)
    : `${localDate(date)} ${localTimeOfDay(date)}`
}

function counted(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

function indented(text: string, indent: string) {
  return text.split('\n').join(`\n${indent}`)
}

/** The answer to a write: the entry's number, kind, and time, and nothing else. */
function writeAnswer(entry: Entry) {
  return `#${entry.id} ${entry.kind}, ${fullStamp(entry.writtenAt)}`
}

function decisionsHeading(count: number) {
  return count === 0
    ? 'In force: no decisions'
    : `In force: ${counted(count, 'decision', 'decisions')}, newest first`
}

function decisionLine(entry: Entry, now: Date) {
  return indented(
    `  #${entry.id}  ${entry.decidedBy}  ${entry.writtenBy}  ${listTime(entry.writtenAt, now)}  ${entry.body}`,
    CONTINUATION,
  )
}

function progressHeading(shown: number, total: number) {
  return total === 0
    ? 'Latest progress: none yet'
    : `Latest progress: ${shown} of ${total}, newest first`
}

function progressLine(entry: Entry, now: Date, text: string) {
  return indented(
    `  #${entry.id}  ${entry.writtenBy}  ${listTime(entry.writtenAt, now)}  ${text}`,
    CONTINUATION,
  )
}

function findingsLine({ inForce, total }: InForce['findings']) {
  return `Findings: ${inForce} in force, ${total - inForce} replaced. Search them with: pnpm exec seasoned-skills ledger search <words>`
}

/** What is in force: the decisions, the latest progress whole, and a count of the findings. */
function inForceView({ decisions, progress, findings, now }: InForce) {
  return [
    decisionsHeading(decisions.length),
    ...decisions.map((entry) => decisionLine(entry, now)),
    progressHeading(progress.entries.length, progress.total),
    ...progress.entries.map((entry) => progressLine(entry, now, entry.body)),
    findingsLine(findings),
  ].join('\n')
}

/** An entry's first line, at most 200 characters of it, ending in an ellipsis when cut. */
function firstLineOf(text: string) {
  const [firstLine = ''] = text.split('\n')
  const characters = Array.from(firstLine)
  if (characters.length <= HOOK_PROGRESS_CHARACTERS && firstLine === text)
    return firstLine
  return `${characters.slice(0, HOOK_PROGRESS_CHARACTERS).join('')}${ELLIPSIS}`
}

function olderDecisionsLine(count: number) {
  return `${counted(count, 'older decision', 'older decisions')} in force: run \`pnpm exec seasoned-skills ledger\``
}

function tooLongLine(entry: Entry) {
  return `  #${entry.id} is too long for this view: run \`pnpm exec seasoned-skills ledger show ${entry.id}\``
}

/**
 * The in-force view fitted under the compaction hook's budget. The findings
 * line and the latest progress, each entry cut to its first line, are set
 * aside first. Decisions fill the rest, newest first and only whole, stopping
 * at the first that does not fit; a decision longer than all the room there
 * is for decisions shows as one line pointing at it, and the fitting goes on.
 */
function fittedInForceView({ decisions, progress, findings, now }: InForce) {
  const progressLines = [
    progressHeading(progress.entries.length, progress.total),
    ...progress.entries.map((entry) => progressLine(entry, now, firstLineOf(entry.body))),
    findingsLine(findings),
  ]
  const heading = decisionsHeading(decisions.length)
  const linesLength = (lines: string[]) =>
    lines.reduce((length, line) => length + line.length + 1, 0)
  const room =
    HOOK_BUDGET -
    linesLength([heading, ...progressLines, olderDecisionsLine(decisions.length)])

  const decisionLines: string[] = []
  let left = room
  let fitted = 0
  for (const entry of decisions) {
    const whole = decisionLine(entry, now)
    const line =
      whole.length + 1 > room && tooLongLine(entry).length + 1 <= left
        ? tooLongLine(entry)
        : whole
    if (line.length + 1 > left) break
    decisionLines.push(line)
    left -= line.length + 1
    fitted += 1
  }
  const older = decisions.length - fitted
  return [
    heading,
    ...decisionLines,
    ...(older === 0 ? [] : [olderDecisionsLine(older)]),
    ...progressLines,
  ].join('\n')
}

function entryHeader(entry: Entry) {
  return [
    `#${entry.id} ${entry.kind}, ${fullStamp(entry.writtenAt)}`,
    ...(entry.decidedBy === null ? [] : [`Decided by the ${entry.decidedBy}`]),
    `Written by ${entry.writtenBy}`,
    ...(entry.source === null ? [] : [`Source: ${entry.source}`]),
    ...(entry.replaces === null ? [] : [`Replaces #${entry.replaces}`]),
    ...(entry.replacedBy === null ? [] : [`Replaced by #${entry.replacedBy}`]),
  ]
}

/** One entry whole, with its line of replacements both ways. */
function entryReport(entry: Entry, line: number[]) {
  const replacements =
    line.length < 2
      ? []
      : [
          `Replacement line, oldest first: ${line
            .map((id) => (id === entry.id ? `#${id} (this entry)` : `#${id}`))
            .join(' → ')}`,
        ]
  return [...entryHeader(entry), ...replacements, '', entry.body].join('\n')
}

/** The whole record, oldest first, as plain text a person can read end to end or keep. */
function recordText(sessionId: string, entries: Entry[]) {
  const blocks = entries.map((entry) =>
    [...entryHeader(entry), '', entry.body].join('\n'),
  )
  return [
    `Ledger of session ${sessionId}: ${counted(entries.length, 'entry', 'entries')}, oldest first`,
    ...blocks,
  ].join('\n\n')
}

function searchHeader(entry: Entry, now: Date) {
  return [
    `#${entry.id} ${entry.kind}`,
    ...(entry.decidedBy === null ? [] : [`decided by the ${entry.decidedBy}`]),
    `written by ${entry.writtenBy}`,
    listTime(entry.writtenAt, now),
    ...(entry.replacedBy === null ? [] : [`replaced by #${entry.replacedBy}`]),
  ].join(', ')
}

/** The best matches, each an excerpt with where it came from, and how many more there are. */
function searchReport({ matches, total }: SearchResults, now: Date) {
  if (matches.length === 0) return "Nothing in this session's ledger matches those words."
  const results = matches.map((match) =>
    [
      searchHeader(match, now),
      ...(match.source === null ? [] : [`  Source: ${match.source}`]),
      `  ${indented(match.excerpt, '  ')}`,
    ].join('\n'),
  )
  const more = total - matches.length
  return [...results, ...(more === 0 ? [] : [`${more} more not shown`])].join('\n\n')
}

export {
  entryReport,
  fittedInForceView,
  HOOK_BUDGET,
  inForceView,
  recordText,
  searchReport,
  writeAnswer,
}
