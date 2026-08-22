# Shared helpers for the worktree scripts. Sourced, never executed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

MANAGED_MARKER="# --- managed by the worktrees skill (per-lane isolation) ---"
MANAGED_END_MARKER="# --- end managed block ---"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_repo() {
  local repo="$1"
  [ -n "$repo" ] || die "missing <repo> argument"
  [ -d "$WORKSPACE_ROOT/$repo/.git" ] || die "$repo is not a cloned repo under $WORKSPACE_ROOT (run the workspace clone script first)"
}

require_lane() {
  local lane="$1"
  [ -n "$lane" ] || die "missing <lane> argument"
  echo "$lane" | grep -Eq '^[a-z0-9][a-z0-9-]*$' || die "lane must be a lowercase slug (a-z, 0-9, hyphens): got '$lane'"
}

lane_slug() {
  echo "$1" | tr '-' '_'
}

worktree_path() {
  local repo="$1" lane="$2"
  echo "$WORKSPACE_ROOT/${repo}-worktrees/$lane"
}

lane_development_database() {
  echo "product_worktree_$(lane_slug "$1")"
}

lane_message_database() {
  echo "product_worktree_$(lane_slug "$1")_message"
}

# Deterministic small hash of a string (0-9999), used to spread ports and
# Redis database indexes across lanes.
lane_hash() {
  echo "$1" | cksum | awk '{print $1 % 10000}'
}

# First free TCP port at or above the deterministic candidate.
free_port() {
  local base="$1" span="$2" seed="$3"
  local port=$((base + $(lane_hash "$seed") % span))
  while port_listening "$port"; do
    port=$((port + 1))
    [ "$port" -lt $((base + span + 100)) ] || die "no free port found near $base for $seed"
  done
  echo "$port"
}

default_branch() {
  local repo_dir="$1"
  git -C "$repo_dir" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' && return
  git -C "$repo_dir" show-ref --verify --quiet refs/remotes/origin/main && echo main && return
  echo master
}

# Read a key's value from an env file (last assignment wins), without quotes.
# Returns empty output (success) when the file or key is absent.
env_file_value() {
  local file="$1" key="$2"
  { grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]\$//"; } || true
}

# The main checkout's env file — the source of truth for where local services
# live on this machine. Falls back to the repo's sample.
main_env_file() {
  local repo_dir="$1"
  if [ -f "$repo_dir/.env" ]; then echo "$repo_dir/.env"; else echo "$repo_dir/contrib/env-sample"; fi
}

# postgres://user:pass@host:5432/dbname -> postgres://user:pass@host:5432
# URLs without a database path are returned unchanged.
url_without_database() {
  echo "$1" | sed -E 's|(://[^/]+)/[^/]*$|\1|'
}

# redis://host:6379 or redis://host:6379/2 -> redis://host:6379
redis_url_base() {
  echo "$1" | sed -E 's|/[0-9]+$||'
}

# Flush a lane's Redis database. Indexes recycle across lanes, and a recycled
# index carries the previous tenant's keys and queue backlogs unless flushed.
# Never touches an index-less URL or database 0 — the main checkout's default.
flush_lane_redis() {
  local url="$1" index
  index="$(echo "$url" | sed -nE 's|.*/([0-9]+)$|\1|p')"
  if [ -z "$index" ] || [ "$index" = "0" ]; then
    return 0
  fi
  if ! command -v redis-cli >/dev/null 2>&1; then
    echo "WARNING: redis-cli not found — $url not flushed and may carry a previous lane's keys"
    return 0
  fi
  if redis-cli -u "$url" flushdb >/dev/null 2>&1; then
    echo "Flushed Redis database $url"
  else
    echo "WARNING: could not flush Redis database $url"
  fi
}

# Port of a URL, or the given default when the URL leaves it implicit.
url_port() {
  local url="$1" default="$2"
  local port
  port="$(echo "$url" | sed -nE 's|^[a-z+]+://([^@]*@)?[^:/]+:([0-9]+).*|\2|p')"
  echo "${port:-$default}"
}

# Whether something is serving the port. A TCP connect probe, not lsof:
# unprivileged lsof cannot see other users' sockets, so a root-owned listener
# (docker-proxy for another project's container) reads as a free port and the
# compose startup then fails on the bind.
port_listening() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null || return 1
  exec 3>&- 2>/dev/null || true
}

# Replace (or append) the managed block in an env file. Reads the block's
# lines from stdin. The block is the idempotency sentinel: re-running setup
# rewrites it in place and never duplicates it. A begin marker without its
# end marker is a hand-edit we refuse to guess about.
write_managed_block() {
  local env_file="$1"
  local block
  block="$(cat)"
  touch "$env_file"
  if grep -qF "$MANAGED_MARKER" "$env_file"; then
    grep -qF "$MANAGED_END_MARKER" "$env_file" || \
      die "unterminated managed block in $env_file — restore the '$MANAGED_END_MARKER' line (or remove the block) and re-run"
    awk -v marker="$MANAGED_MARKER" -v end="$MANAGED_END_MARKER" '
      $0 == marker {skip=1; next}
      $0 == end {skip=0; next}
      !skip {print}
    ' "$env_file" > "$env_file.tmp"
    mv "$env_file.tmp" "$env_file"
  fi
  {
    echo "$MANAGED_MARKER"
    echo "$block"
    echo "$MANAGED_END_MARKER"
  } >> "$env_file"
}

# Run a SQL statement against the server behind a DATABASE_URL, connecting to
# its maintenance database so the statement works before any app database exists.
dev_psql() {
  local connection_url="$1" sql="$2"
  command -v psql >/dev/null 2>&1 || die "psql not found — install a Postgres client to manage lane databases"
  psql "$(url_without_database "$connection_url")/postgres" -v ON_ERROR_STOP=1 -qtAc "$sql"
}

# Wait until the Postgres server answers, dying loudly on timeout so callers
# never mistake "server down" for "database absent".
require_database_server() {
  local connection_url="$1" timeout_seconds="${2:-5}"
  local waited=0
  until dev_psql "$connection_url" "SELECT 1" >/dev/null 2>&1; do
    waited=$((waited + 1))
    [ "$waited" -le "$timeout_seconds" ] || \
      die "cannot reach the Postgres server behind $(url_without_database "$connection_url") — is it running?"
    sleep 1
  done
}

database_exists() {
  [ "$(dev_psql "$1" "SELECT 1 FROM pg_database WHERE datname = '$2'")" = "1" ]
}

# Create an empty lane database, unless it is already there.
create_lane_database() {
  local connection_url="$1" name="$2"
  if database_exists "$connection_url" "$name"; then
    echo "Database $name already exists"
    return
  fi
  dev_psql "$connection_url" "CREATE DATABASE \"$name\"" >/dev/null
  echo "Created database $name"
}

# Whether neither of a lane's databases exists yet, i.e. this run is the one
# creating the pair. Only answerable before the creates.
lane_databases_are_absent() {
  local connection_url="$1" development_database="$2" message_database="$3"
  ! database_exists "$connection_url" "$development_database" &&
    ! database_exists "$connection_url" "$message_database"
}

# Why a lane must not be seeded — empty output means it must. Seeding belongs
# to a pair created from scratch: an existing pair holds a developer's data a
# second seed would collide with, and a branch older than the seed has no
# target to run.
lane_seed_refusal() {
  local databases_are_new="$1" seed_requested="$2" makefile="$3"
  if [ "$databases_are_new" != true ]; then
    echo "existing databases reused"
  elif [ "$seed_requested" != true ]; then
    echo "--skip-seed was passed"
  elif ! grep -qE '^seed:' "$makefile"; then
    echo "this branch's Makefile has no seed target"
  fi
}

# Drop every database in a lane's family: the dev and message pair, the E2E
# pair the e2e harness derives from them, and the test_/xdist-worker (_gwN)
# clones pytest creates. The suffix whitelist keeps a sibling lane whose slug
# merely extends this one (lane-a vs lane-a-extra) out of the blast radius.
drop_lane_database_family() {
  local connection_url="$1" base="$2"
  local pattern="^(test_)?${base}(_message|_e2e|_e2e_message)?(_gw[0-9]+)?\$"
  local name
  for name in $(dev_psql "$connection_url" "SELECT datname FROM pg_database WHERE datname ~ '$pattern' ORDER BY datname"); do
    drop_lane_database "$connection_url" "$name"
  done
}

# Drop a lane database. Refuses anything not created by these scripts.
drop_lane_database() {
  local connection_url="$1" name="$2"
  case "$name" in
    product_worktree_*|test_product_worktree_*) ;;
    *) die "refusing to drop $name — only product_worktree_* databases are lane-owned" ;;
  esac
  if database_exists "$connection_url" "$name"; then
    dev_psql "$connection_url" "DROP DATABASE \"$name\" WITH (FORCE)" >/dev/null
    echo "Dropped database $name"
  fi
}
