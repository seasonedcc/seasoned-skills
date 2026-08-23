#!/bin/sh
# Browser-leak sweep for agent-browser.
#
#   seasoned-skills sweep --browsers          list survivors with their ages, exit 1 if any are alive
#   seasoned-skills sweep --browsers --kill   kill each survivor by its exact pid, then re-list
#
# Scoped to Chrome for Testing binaries living under an .agent-browser install and to
# the agent-browser daemon, so no unrelated process on the machine can be matched.
# Counts and ages are the measurement: resident memory understates a leak badly once
# the leaked processes have been paged out.

set -u

chrome_pattern='[.]agent-browser/browsers.*Chrome for Testing'
daemon_pattern='agent-browser[-](darwin|linux)-'

processes() {
  ps axo pid=,etime=,command= | grep -E "$1"
}

pids() {
  processes "$1" | awk '{ print $1 }'
}

count() {
  pids "$1" | grep -c .
}

report() {
  echo "$1: $(count "$2")"
  processes "$2" | awk '{ print "  pid=" $1 " age=" $2 }'
}

if [ "${1:-}" = '--kill' ] || [ "${1:-}" = 'kill' ]; then
  for pid in $(pids "$chrome_pattern") $(pids "$daemon_pattern"); do
    echo "killing pid=$pid"
    kill -9 "$pid" 2>/dev/null
  done
  sleep 2
fi

report 'Chrome for Testing processes' "$chrome_pattern"
report 'agent-browser daemons' "$daemon_pattern"

alive=$(( $(count "$chrome_pattern") + $(count "$daemon_pattern") ))
if [ "$alive" -gt 0 ]; then
  echo "SWEEP: $alive processes still alive — NOT clean"
  exit 1
fi
echo 'SWEEP: clean — zero browser processes, zero daemons'
