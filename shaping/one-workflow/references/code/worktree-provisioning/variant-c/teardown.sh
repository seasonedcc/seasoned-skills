#!/usr/bin/env bash
# Remove a lane's worktree and its provisioned resources.
#
#   teardown.sh <repo> <lane> [--force]
#
# Refuses when the worktree has uncommitted changes (unless --force). Kills
# only processes that both listen on the lane's managed port AND run from
# inside the lane's worktree, drops the lane's databases (only ever
# product_worktree_*), and removes the worktree. It never touches the branch —
# it may back a PR.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

REPO="${1:-}"
LANE="${2:-}"
require_repo "$REPO"
require_lane "$LANE"
FORCE=false
[ "${3:-}" = "--force" ] && FORCE=true

REPO_DIR="$WORKSPACE_ROOT/$REPO"
WORKTREE_DIR="$(worktree_path "$REPO" "$LANE")"

if [ -d "$WORKTREE_DIR" ]; then
  if [ -n "$(git -C "$WORKTREE_DIR" status --porcelain 2>/dev/null)" ] && [ "$FORCE" != true ]; then
    die "worktree has uncommitted changes — commit/push them or re-run with --force"
  fi

  port="$(env_file_value "$WORKTREE_DIR/.env" DEV_SERVER_PORT)"
  if [ -n "$port" ]; then
    for pid in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
      pid_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
      case "$pid_cwd" in
        "$WORKTREE_DIR"*)
          echo "Killing lane process $pid on port $port"
          kill "$pid" 2>/dev/null || true ;;
        *)
          echo "Leaving process $pid on port $port alone — it does not run from this lane's worktree" ;;
      esac
    done
  fi
fi

if [ "$REPO" = "product-monolith" ]; then
  LANE_REDIS_URL="$(env_file_value "$WORKTREE_DIR/.env" REDIS_URL)"
  if [ -n "$LANE_REDIS_URL" ]; then
    flush_lane_redis "$LANE_REDIS_URL"
  fi
  MAIN_DATABASE_URL="$(env_file_value "$(main_env_file "$REPO_DIR")" DATABASE_URL)"
  if [ -n "$MAIN_DATABASE_URL" ]; then
    require_database_server "$MAIN_DATABASE_URL" 5
    drop_lane_database_family "$MAIN_DATABASE_URL" "$(lane_development_database "$LANE")"
  fi
fi

if [ -d "$WORKTREE_DIR" ]; then
  if [ "$FORCE" = true ]; then
    git -C "$REPO_DIR" worktree remove --force "$WORKTREE_DIR"
  else
    git -C "$REPO_DIR" worktree remove "$WORKTREE_DIR"
  fi
  echo "Removed worktree $WORKTREE_DIR"
else
  git -C "$REPO_DIR" worktree prune
  echo "No worktree at $WORKTREE_DIR (pruned stale registrations)"
fi
