"""
Reads a Bash command the way the managed guard hooks need it: which words
the shell runs, outside quotes and heredoc bodies, across lists, pipelines,
subshells, and command substitutions. It finds the ledger commands among
them and answers one question about the command in a hook's JSON payload on
standard input, named by its one argument:

  refusal          why the ledger write guard refuses the command, or
                   nothing when it passes
  outside-entries  the command without the text of its ledger entries, for
                   guards that match on command text: an entry is recorded,
                   never run. A command it cannot read, or cannot read
                   within two seconds, comes back whole.

The hooks run it as a script with python3 -B, so it never leaves bytecode
beside them. Standard library only, and Python 3.9 compatible.
"""

import json
import re
import signal
import sys

KINDS = ('decision', 'finding', 'progress')
VALUE_OPTIONS = ('--as', '--by', '--source', '--replaces', '--session')
ENTRY_HEREDOC = "'ENTRY'"
BINARY = re.compile(
    r'(^|/)seasoned-skills(@[^/]*)?$|(^|/)seasoned-skills\.js$|(^|/)cli/index\.[jt]s$'
)
OPERATORS = ('&&', '||', ';;', ';', '|&', '|', '&')
REDIRECTION = re.compile(r'(\d*)(<<<|<<-|<<|<>|<&|<|>>|>&|>\||>)|&>>|&>')
STANDARD_INPUT = {'<<<', '<<-', '<<', '<>', '<&', '<'}
METACHARACTERS = set(' \t\n;&|<>()')
PARAMETER = re.compile(r'\$([A-Za-z_][A-Za-z0-9_]*|[0-9#?$!@*-])?')
READING_TIME_LIMIT = 2

FORM = (
    "\n\nWrite each entry as one command that ends with it, its text on standard"
    " input through <<'ENTRY':\n\n"
    "pnpm exec seasoned-skills ledger finding --as <writer> --source '<where>' <<'ENTRY'\n"
    "<the entry's text: any lines but one that is exactly ENTRY>\n"
    "ENTRY"
)
COMMENT_REFUSAL = (
    'Refused: this ledger command has an unquoted word starting with #, which the'
    ' shell reads as the start of a comment. Nothing after it reaches the ledger,'
    " a heredoc included, and the entry's lines would then run as commands. Write"
    ' entry numbers bare: --replaces 47, ledger show 47.'
)
SECOND_WRITE_REFUSAL = (
    'Refused: this command holds more than one ledger write. Send each entry in a'
    ' Bash command of its own.'
)
TEXT_REFUSAL = (
    "Refused: the entry's text must arrive through <<'ENTRY', the single-quoted"
    ' heredoc the shell never expands. A pipe (echo ... |), a file, a here-string,'
    ' an unquoted or double-quoted heredoc, or no heredoc at all lets the shell'
    ' expand or lose the text, and $( ) or backticks in it would run as commands.'
)
UNCLOSED_REFUSAL = (
    "Refused: the entry's heredoc never closes. End the entry with a line that is"
    ' exactly ENTRY.'
)
SOURCE_REFUSAL = (
    'Refused: --source holds a backtick or a $ outside single quotes, so the shell'
    " would run it or swap in a variable's value before the ledger sees it."
    " Single-quote the source: --source 'git log printed $SHA'."
)
TRAILING_REFUSAL = (
    'Refused: something follows the ledger write. A write may be preceded, as in'
    ' cd <dir> && ..., but it must end the command: nothing after'
    " <<'ENTRY' on its line, and nothing after the closing ENTRY line. If the"
    " entry's text holds a line that is exactly ENTRY, that line closed the"
    ' heredoc early and the lines after it would run as commands: reword it.'
)


class Word:
    def __init__(self, text, raw, expands):
        self.text = text
        self.raw = raw
        self.expands = expands


class Heredoc:
    def __init__(self, operator, delimiter):
        self.operator = operator
        self.delimiter = delimiter
        self.body_start = None
        self.end = None
        self.closed = False

    def expands(self):
        return not any(quote in self.delimiter.raw for quote in '\'"\\')


class Redirection:
    def __init__(self, descriptor, operator, target, heredoc):
        self.descriptor = descriptor
        self.operator = operator
        self.target = target
        self.heredoc = heredoc


class Command:
    def __init__(self, piped):
        self.piped = piped
        self.words = []
        self.redirections = []
        self.followed_by = ''
        self.comment = False

    def is_empty(self):
        return not self.words and not self.redirections


def closing_backtick(line):
    index = 0
    while index < len(line):
        if line[index] == '`':
            return index
        index += 2 if line[index] == '\\' else 1
    return None


class Reader:
    def __init__(self, text):
        self.text = text
        self.commands = []
        self.pending = []
        self.not_arithmetic = set()

    def read(self):
        self.read_list(0, None)
        self.leave_pending(len(self.text))
        return self.commands

    def leave_pending(self, position):
        for heredoc in self.pending:
            heredoc.body_start = heredoc.end = position
        self.pending = []

    def finish(self, command, followed_by):
        if not command.is_empty():
            command.followed_by = followed_by
            self.commands.append(command)

    def read_list(self, position, closer):
        text = self.text
        command = Command(False)
        while position < len(text):
            character = text[position]
            if character in ' \t':
                position += 1
            elif text.startswith('\\\n', position):
                position += 2
            elif character == closer:
                self.finish(command, '')
                return position + 1
            elif character == '\n':
                if not command.is_empty():
                    self.finish(command, '\n')
                    command = Command(False)
                position = self.read_heredoc_bodies(position + 1, closer)
            elif character == '#':
                command.comment = not command.is_empty()
                newline = text.find('\n', position)
                position = len(text) if newline == -1 else newline
            elif text.startswith('((', position):
                arithmetic = self.read_arithmetic(position + 2, False)
                position = arithmetic or self.read_list(position + 1, ')')
            elif character == '(':
                position = self.read_list(position + 1, ')')
            elif character == ')':
                position += 1
            else:
                operator = self.operator_at(position)
                if operator:
                    self.finish(command, operator)
                    command = Command(operator in ('|', '|&'))
                    position += len(operator)
                    continue
                redirection = REDIRECTION.match(text, position)
                if redirection and not text.startswith(('<(', '>('), position):
                    position = self.read_redirection(redirection, command, closer)
                else:
                    word, position = self.read_word(position, closer)
                    command.words.append(word)
        self.finish(command, '')
        return position

    def operator_at(self, position):
        for operator in OPERATORS:
            if self.text.startswith(operator, position):
                if operator == '&' and self.text.startswith('&>', position):
                    return None
                return operator
        return None

    def read_redirection(self, match, command, closer):
        text = self.text
        descriptor = match.group(1) or ''
        operator = match.group(2) or match.group(0)
        position = match.end()
        while position < len(text) and text[position] in ' \t':
            position += 1
        target = None
        if position < len(text) and text[position] not in METACHARACTERS:
            target, position = self.read_word(position, closer)
        heredoc = None
        if operator in ('<<', '<<-') and target is not None:
            heredoc = Heredoc(operator, target)
            self.pending.append(heredoc)
        command.redirections.append(Redirection(descriptor, operator, target, heredoc))
        return position

    def read_heredoc_bodies(self, position, closer):
        text = self.text
        while self.pending:
            heredoc = self.pending.pop(0)
            heredoc.body_start = position
            while position < len(text):
                newline = text.find('\n', position)
                line_end = len(text) if newline == -1 else newline
                line = text[position:line_end]
                backtick = closing_backtick(line) if closer == '`' else None
                if backtick is not None:
                    position += backtick
                    break
                if heredoc.operator == '<<-':
                    line = line.lstrip('\t')
                if line == heredoc.delimiter.text:
                    body_end = position
                    heredoc.closed = True
                position = len(text) if newline == -1 else newline + 1
                if heredoc.closed:
                    break
            if not heredoc.closed:
                body_end = position
            heredoc.end = position
            if heredoc.expands():
                self.read_substitutions(heredoc.body_start, body_end)
        return position

    def read_substitutions(self, position, end):
        pending, self.pending = self.pending, []
        while position < end:
            character = self.text[position]
            if character == '\\':
                position += 2
            elif character == '$':
                position = self.read_dollar(position, [], True)
            elif character == '`':
                position = self.read_list(position + 1, '`')
            else:
                position += 1
        self.leave_pending(end)
        self.pending = pending

    def read_word(self, position, closer):
        text = self.text
        start = position
        value = []
        expands = False
        while position < len(text):
            character = text[position]
            if text.startswith(('<(', '>('), position):
                end = self.read_list(position + 2, ')')
                value.append(text[position:end])
                position = end
            elif character in METACHARACTERS or character == closer:
                break
            elif character == '\\':
                if not text.startswith('\\\n', position):
                    value.append(text[position + 1 : position + 2])
                    expands = expands or text[position + 1 : position + 2] in ('$', '`')
                position += 2
            elif character == "'":
                end = text.find("'", position + 1)
                end = len(text) if end == -1 else end
                value.append(text[position + 1 : end])
                position = end + 1
            elif character == '"':
                position, expanded = self.read_double_quoted(position + 1, value)
                expands = expands or expanded
            elif character == '$':
                expands = True
                position = self.read_dollar(position, value, False)
            elif character == '`':
                expands = True
                end = self.read_list(position + 1, '`')
                value.append(text[position:end])
                position = end
            else:
                value.append(character)
                position += 1
        return Word(''.join(value), text[start:position], expands), position

    def read_double_quoted(self, position, value):
        text = self.text
        expands = False
        while position < len(text):
            character = text[position]
            if character == '"':
                return position + 1, expands
            if character == '\\' and text[position + 1 : position + 2] in ('"', '\\', '$', '`', '\n'):
                escaped = text[position + 1]
                expands = expands or escaped in ('$', '`')
                if escaped != '\n':
                    value.append(escaped)
                position += 2
            elif character == '$':
                expands = True
                position = self.read_dollar(position, value, True)
            elif character == '`':
                expands = True
                end = self.read_list(position + 1, '`')
                value.append(text[position:end])
                position = end
            else:
                value.append(character)
                position += 1
        return position, expands

    def read_dollar(self, position, value, quoted):
        text = self.text
        if text.startswith('$((', position):
            end = self.read_arithmetic(position + 3, quoted) or self.read_list(position + 2, ')')
        elif text.startswith('$(', position):
            end = self.read_list(position + 2, ')')
        elif text.startswith('${', position):
            end = min(self.read_expansion(position + 2, '}', quoted) + 1, len(text))
        elif text.startswith("$'", position) and not quoted:
            end = position + 2
            while end < len(text) and text[end] != "'":
                end += 2 if text[end] == '\\' else 1
            end = min(end + 1, len(text))
        elif text.startswith('$"', position) and not quoted:
            end, _ = self.read_double_quoted(position + 2, [])
        else:
            end = PARAMETER.match(text, position).end()
        value.append(text[position:end])
        return end

    def read_arithmetic(self, position, quoted):
        if position in self.not_arithmetic:
            return None
        commands, pending = len(self.commands), list(self.pending)
        end = self.read_expansion(position, ')', quoted)
        if self.text.startswith('))', end):
            return end + 2
        del self.commands[commands:]
        self.pending = pending
        self.not_arithmetic.add(position)
        return None

    def read_expansion(self, position, closer, quoted):
        text = self.text
        opener = '(' if closer == ')' else None
        depth = 0
        while position < len(text):
            character = text[position]
            if character == closer and depth == 0:
                return position
            if character == '\\':
                position += 2
            elif character == "'" and not quoted:
                end = text.find("'", position + 1)
                position = len(text) if end == -1 else end + 1
            elif character == '"':
                position, _ = self.read_double_quoted(position + 1, [])
            elif character == '$':
                position = self.read_dollar(position, [], quoted)
            elif character == '`':
                position = self.read_list(position + 1, '`')
            else:
                if character == opener:
                    depth += 1
                elif character == closer:
                    depth -= 1
                position += 1
        return position


def ledger_arguments(command):
    words = command.words
    for index, word in enumerate(words):
        if BINARY.search(word.text):
            following = words[index + 1 :]
            if following and following[0].text == '--':
                following = following[1:]
            if following and following[0].text == 'ledger':
                return following[1:]
    return None


def ledger_kind(arguments):
    index = 0
    while index < len(arguments):
        word = arguments[index].text
        if word == '--session':
            index += 2
        elif word.startswith('-'):
            index += 1
        else:
            return word if word in KINDS else None
    return None


def sources(arguments):
    for index, word in enumerate(arguments):
        if word.text == '--source' and index + 1 < len(arguments):
            yield arguments[index + 1]
        elif word.text.startswith('--source='):
            yield word


def source_expands(arguments):
    return any(source.expands for source in sources(arguments))


def standard_inputs(command):
    return [
        redirection
        for redirection in command.redirections
        if redirection.descriptor in ('', '0') and redirection.operator in STANDARD_INPUT
    ]


def asks_for_help(command, arguments):
    if command.piped or standard_inputs(command):
        return False
    index = 0
    while index < len(arguments):
        word = arguments[index].text
        if word in ('-h', '--help'):
            return True
        index += 2 if word in VALUE_OPTIONS else 1
    return False


def is_entry_heredoc(redirection):
    return (
        redirection.heredoc is not None
        and redirection.operator == '<<'
        and redirection.target.raw == ENTRY_HEREDOC
    )


def ledger_commands(commands):
    for command in commands:
        arguments = ledger_arguments(command)
        if arguments is not None:
            yield command, arguments


def refusal(text):
    found = list(ledger_commands(Reader(text).read()))
    if any(command.comment for command, _ in found):
        return COMMENT_REFUSAL
    writes = [(command, arguments) for command, arguments in found if ledger_kind(arguments)]
    if not writes:
        return ''
    if len(writes) > 1:
        return SECOND_WRITE_REFUSAL + FORM
    write, arguments = writes[0]
    if asks_for_help(write, arguments):
        return SOURCE_REFUSAL + FORM if source_expands(arguments) else ''
    inputs = standard_inputs(write)
    if write.piped or len(inputs) != 1 or not is_entry_heredoc(inputs[0]):
        return TEXT_REFUSAL + FORM
    heredoc = inputs[0].heredoc
    if not heredoc.closed:
        return UNCLOSED_REFUSAL + FORM
    if source_expands(arguments):
        return SOURCE_REFUSAL + FORM
    if write.followed_by not in ('\n', '') or text[heredoc.end :].strip():
        return TRAILING_REFUSAL + FORM
    return ''


def outside_entries(text):
    entries = [
        (redirection.heredoc.body_start, redirection.heredoc.end)
        for command, arguments in ledger_commands(Reader(text).read())
        if ledger_kind(arguments)
        for redirection in command.redirections
        if is_entry_heredoc(redirection)
    ]
    kept = []
    position = 0
    for start, end in sorted(entries):
        kept.append(text[position:start])
        position = max(position, end)
    kept.append(text[position:])
    return ''.join(kept)


def took_too_long(signal_number, frame):
    raise TimeoutError('the command took too long to read')


def main():
    payload = json.loads(sys.stdin.buffer.read().decode('utf-8', 'replace'))
    tool_input = payload.get('tool_input') if isinstance(payload, dict) else None
    command = tool_input.get('command') if isinstance(tool_input, dict) else None
    if not isinstance(command, str):
        command = ''
    question = sys.argv[1] if len(sys.argv) > 1 else ''
    if question == 'refusal':
        answer = refusal(command)
    elif question == 'outside-entries':
        signal.signal(signal.SIGALRM, took_too_long)
        signal.setitimer(signal.ITIMER_REAL, READING_TIME_LIMIT)
        try:
            answer = outside_entries(command)
            signal.setitimer(signal.ITIMER_REAL, 0)
        except Exception:
            signal.setitimer(signal.ITIMER_REAL, 0)
            answer = command
    else:
        sys.exit('usage: command-reader.py refusal|outside-entries < hook-payload.json')
    sys.stdout.buffer.write(answer.encode('utf-8', 'replace'))


main()
