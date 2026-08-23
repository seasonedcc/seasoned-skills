#!/bin/bash
# Claude Code status line
#   Line 1: the user's real shell prompt, rendered by Starship (their PS1)
#   Line 2: context-window usage as a color-coded progress bar
#
# Reads session JSON on stdin. See https://code.claude.com/docs/en/statusline

input=$(cat)

# --- Line 1: Starship prompt (replicates the shell PS1) -----------------------
# cd into the session's directory so Starship reports the right path / git info.
DIR=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // empty')
[ -n "$DIR" ] && [ -d "$DIR" ] && cd "$DIR" 2>/dev/null

STARSHIP_LINE=""
if command -v starship >/dev/null 2>&1; then
  # Force zsh-style output, strip the %{ %} prompt-escape wrappers (leaving raw
  # ANSI), drop Starship's leading blank line, and keep only the info line
  # (the second line is just the "❯" input character, which we don't want here).
  STARSHIP_LINE=$(STARSHIP_SHELL=zsh starship prompt --status 0 2>/dev/null \
    | sed -e 's/%{//g' -e 's/%}//g' -e 's/\\\[//g' -e 's/\\\]//g' \
    | sed '/^[[:space:]]*$/d' \
    | head -n 1)
fi

# --- Line 2: context-window progress bar --------------------------------------
PCT=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
[ -z "$PCT" ] && PCT=0
MODEL=$(printf '%s' "$input" | jq -r '.model.display_name // "?"')
USED=$(printf '%s'  "$input" | jq -r '.context_window.total_input_tokens // 0')
SIZE=$(printf '%s'  "$input" | jq -r '.context_window.context_window_size // 0')

BAR_WIDTH=20
FILLED=$((PCT * BAR_WIDTH / 100))
[ "$FILLED" -gt "$BAR_WIDTH" ] && FILLED=$BAR_WIDTH
[ "$FILLED" -lt 0 ] && FILLED=0
EMPTY=$((BAR_WIDTH - FILLED))

BAR=""
[ "$FILLED" -gt 0 ] && printf -v FILL "%${FILLED}s" "" && BAR="${FILL// /▓}"
[ "$EMPTY"  -gt 0 ] && printf -v PAD  "%${EMPTY}s"  "" && BAR="${BAR}${PAD// /░}"

# Color the bar/percentage by how full the context is.
if   [ "$PCT" -lt 25 ]; then COLOR=$'\033[32m'   # green
elif [ "$PCT" -lt 33 ]; then COLOR=$'\033[33m'   # yellow
else                         COLOR=$'\033[31m'   # red
fi
RESET=$'\033[0m'
DIM=$'\033[2m'

# Human-readable token counts (e.g. 123k / 1M).
human() {
  local n=$1
  if   [ "$n" -ge 1000000 ]; then printf '%d.%dM' $((n/1000000)) $(((n%1000000)/100000))
  elif [ "$n" -ge 1000 ];    then printf '%dk' $((n/1000))
  else                            printf '%d' "$n"
  fi
}

EFFORT=$(printf '%s' "$input" | jq -r '.effort.level // empty')

USAGE=""
[ "$SIZE" -gt 0 ] && USAGE=" ${DIM}($(human "$USED")/$(human "$SIZE"))${RESET}"

EFFORT_SUFFIX=""
[ -n "$EFFORT" ] && EFFORT_SUFFIX=" ${DIM}${EFFORT}${RESET}"

# Demotion alarm: the workflow runs the main session on Fable at high effort.
# If the classifier demotes the model (or drops the effort), wrap the
# model + effort segment in sirens and paint it red so it's impossible to miss.
ALERT_PRE="" ALERT_POST=""
case "$MODEL" in
  *[Ff]able*) MODEL_OK=1 ;;
  *)          MODEL_OK=0 ;;
esac
if [ "$MODEL_OK" -eq 0 ] || { [ -n "$EFFORT" ] && [ "$EFFORT" != "high" ]; }; then
  ALERT_PRE="🚨 "
  ALERT_POST=" 🚨"
  DIM=$'\033[41;97;1m'   # red background, bright white bold, instead of dim
  [ -n "$EFFORT" ] && EFFORT_SUFFIX=" ${DIM}${EFFORT}${RESET}"
fi

[ -n "$STARSHIP_LINE" ] && printf '%s\n' "$STARSHIP_LINE"
printf '%s%s %d%%%s%s %s%s%s%s%s%s\n' \
  "$COLOR" "$BAR" "$PCT" "$RESET" "$USAGE" "$ALERT_PRE" "$DIM" "$MODEL" "$RESET" "$EFFORT_SUFFIX" "$ALERT_POST"
