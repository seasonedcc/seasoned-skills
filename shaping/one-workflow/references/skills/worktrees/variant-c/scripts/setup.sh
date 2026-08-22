#!/usr/bin/env bash
# Create (or reuse) an isolated worktree of one workspace repo for a lane.
#
#   setup.sh <repo> <lane> [--branch <name>] [--base <ref>] [--skip-provision] [--skip-seed]
#
# Idempotent: re-running reuses the registered worktree, its databases, its
# ports, and its Redis index (the managed env block is the allocation record).
# Prints a summary with everything the lane needs.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

REPO="${1:-}"
LANE="${2:-}"
require_repo "$REPO"
require_lane "$LANE"
shift 2

BRANCH=""
BASE=""
PROVISION=true
SEED=true
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) [ $# -ge 2 ] || die "--branch requires a value"; BRANCH="$2"; shift 2 ;;
    --base) [ $# -ge 2 ] || die "--base requires a value"; BASE="$2"; shift 2 ;;
    --skip-provision) PROVISION=false; shift ;;
    --skip-seed) SEED=false; shift ;;
    *) die "unknown option: $1 (usage: setup.sh <repo> <lane> [--branch <name>] [--base <ref>] [--skip-provision] [--skip-seed])" ;;
  esac
done

REPO_DIR="$WORKSPACE_ROOT/$REPO"
WORKTREE_DIR="$(worktree_path "$REPO" "$LANE")"
[ -n "$BRANCH" ] || BRANCH="worktree/$LANE"

if [ -d "$WORKTREE_DIR" ] && git -C "$WORKTREE_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Reusing existing worktree at $WORKTREE_DIR"
  [ -n "$BASE" ] || BASE="(existing)"
else
  git -C "$REPO_DIR" fetch origin --quiet
  BASE_WAS_EXPLICIT=false
  [ -n "$BASE" ] && BASE_WAS_EXPLICIT=true
  [ -n "$BASE" ] || BASE="origin/$(default_branch "$REPO_DIR")"
  mkdir -p "$(dirname "$WORKTREE_DIR")"
  if git -C "$REPO_DIR" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    # An existing local branch may sit behind its origin counterpart; checking
    # it out silently would hand the lane a stale tip. Fast-forward when that
    # is safe, and warn loudly when it is not.
    if git -C "$REPO_DIR" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
      LOCAL_TIP="$(git -C "$REPO_DIR" rev-parse "refs/heads/$BRANCH")"
      ORIGIN_TIP="$(git -C "$REPO_DIR" rev-parse "refs/remotes/origin/$BRANCH")"
      if [ "$LOCAL_TIP" != "$ORIGIN_TIP" ]; then
        if git -C "$REPO_DIR" merge-base --is-ancestor "$LOCAL_TIP" "$ORIGIN_TIP"; then
          git -C "$REPO_DIR" branch -f "$BRANCH" "$ORIGIN_TIP"
          echo "Fast-forwarded stale local branch $BRANCH to origin/$BRANCH"
        else
          echo "WARNING: $BRANCH and origin/$BRANCH have diverged — the worktree checks out the local tip; reconcile before building on it"
        fi
      fi
    fi
    [ "$BASE_WAS_EXPLICIT" = false ] || echo "NOTE: branch $BRANCH already exists — --base $BASE is ignored"
    BASE="(existing branch)"
    git -C "$REPO_DIR" worktree add "$WORKTREE_DIR" "$BRANCH"
  elif git -C "$REPO_DIR" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    # A branch that already exists on origin (e.g. one backing an open PR) is
    # the tip the lane must start from; basing a fresh local branch of the
    # same name anywhere else silently hands the lane the wrong history.
    [ "$BASE_WAS_EXPLICIT" = false ] || echo "NOTE: origin/$BRANCH exists — --base $BASE is ignored; the lane starts from the remote tip"
    BASE="origin/$BRANCH"
    git -C "$REPO_DIR" worktree add "$WORKTREE_DIR" -b "$BRANCH" "origin/$BRANCH"
  else
    git -C "$REPO_DIR" worktree add "$WORKTREE_DIR" -b "$BRANCH" "$BASE"
    # Branching from a remote-tracking ref makes git adopt that ref as the new
    # branch's upstream, so a bare `git push` from the lane aims at the base
    # branch instead of the lane's own. Drop it: with no upstream, a bare push
    # fails loudly and asks for the explicit refspec the lane must use.
    if [ "$BASE" != "origin/$BRANCH" ] && git -C "$REPO_DIR" show-ref --verify --quiet "refs/remotes/$BASE"; then
      git -C "$REPO_DIR" branch --unset-upstream "$BRANCH" 2>/dev/null || true
    fi
  fi
fi

# Copy gitignored env files from the main checkout so the lane starts from a
# working configuration; per-lane overrides land in the managed block below.
for env_file in .env .env.test; do
  if [ -f "$REPO_DIR/$env_file" ] && [ ! -f "$WORKTREE_DIR/$env_file" ]; then
    cp "$REPO_DIR/$env_file" "$WORKTREE_DIR/$env_file"
    echo "Copied $env_file from the main checkout"
  fi
done

SUMMARY=""

# First free Redis database index (1-14), starting from the lane's hash and
# skipping indexes already claimed by sibling lanes' env files.
allocate_redis_index() {
  local lane_env="$1"
  local taken="" env index offset candidate
  for env in "$WORKSPACE_ROOT"/"$REPO"-worktrees/*/.env; do
    [ -f "$env" ] && [ "$env" != "$lane_env" ] || continue
    index="$(env_file_value "$env" REDIS_URL | sed -nE 's|.*/([0-9]+)$|\1|p')"
    [ -n "$index" ] && taken="$taken $index"
  done
  local start=$((1 + $(lane_hash "$LANE") % 14))
  for offset in $(seq 0 13); do
    candidate=$((1 + (start - 1 + offset) % 14))
    if ! echo "$taken" | grep -qw "$candidate"; then
      echo "$candidate"
      return
    fi
  done
  die "no free Redis database index (1-14) — tear down an unused lane first"
}

provision_product_monolith() {
  command -v uv >/dev/null 2>&1 || die "uv not found — install it first: curl -LsSf https://astral.sh/uv/install.sh | sh"

  local main_env main_database_url main_redis_url
  main_env="$(main_env_file "$REPO_DIR")"
  main_database_url="$(env_file_value "$main_env" DATABASE_URL)"
  main_redis_url="$(env_file_value "$main_env" REDIS_URL)"
  [ -n "$main_database_url" ] || die "no DATABASE_URL in $main_env"
  [ -n "$main_redis_url" ] || main_redis_url="redis://localhost:6379"

  if [ ! -f "$WORKTREE_DIR/.env" ]; then
    cp "$main_env" "$WORKTREE_DIR/.env"
    echo "Created .env from $(basename "$main_env")"
  fi

  # The managed block is the allocation record: keep an existing lane's port
  # and Redis index on re-runs instead of reassigning them.
  local development_database message_database redis_index redis_index_is_new development_server_port
  development_database="$(lane_development_database "$LANE")"
  message_database="$(lane_message_database "$LANE")"
  development_server_port="$(env_file_value "$WORKTREE_DIR/.env" DEV_SERVER_PORT)"
  [ -n "$development_server_port" ] || development_server_port="$(free_port 8100 400 "$LANE")"
  redis_index="$(env_file_value "$WORKTREE_DIR/.env" REDIS_URL | sed -nE 's|.*/([0-9]+)$|\1|p')"
  redis_index_is_new=false
  if [ -z "$redis_index" ]; then
    redis_index="$(allocate_redis_index "$WORKTREE_DIR/.env")"
    redis_index_is_new=true
  fi

  local postgres_base_url redis_base_url
  postgres_base_url="$(url_without_database "$main_database_url")"
  redis_base_url="$(redis_url_base "$main_redis_url")"

  write_managed_block "$WORKTREE_DIR/.env" <<EOF
DATABASE_URL=$postgres_base_url/$development_database
DATABASE_MESSAGE_URL=$postgres_base_url/$message_database
REDIS_URL=$redis_base_url/$redis_index
CELERY_URL=$redis_base_url/$redis_index
DEV_SERVER_PORT=$development_server_port
EOF

  # Start the repo's docker services only for ports nothing else is serving —
  # the machine may run its own Postgres/Redis, and the main env file is the
  # source of truth for where they live.
  local services=""
  port_listening "$(url_port "$main_database_url" 5432)" || services="database"
  port_listening "$(url_port "$main_redis_url" 6379)" || services="$services redis"
  if [ -n "$services" ]; then
    docker network inspect product_monolith >/dev/null 2>&1 || docker network create product_monolith >/dev/null
    (cd "$REPO_DIR" && docker compose -f docker-compose-dev.yml up -d $services >/dev/null)
  fi
  require_database_server "$main_database_url" 60

  # A freshly allocated index may have belonged to a lane that died without
  # teardown — flush before first use so its keys and queues cannot leak in.
  if [ "$redis_index_is_new" = true ]; then
    flush_lane_redis "$redis_base_url/$redis_index"
  fi

  # Asked before the creates, which erase the distinction: only a lane whose
  # pair this run creates gets seeded.
  local databases_are_new=false
  if lane_databases_are_absent "$main_database_url" "$development_database" "$message_database"; then
    databases_are_new=true
  fi

  create_lane_database "$main_database_url" "$development_database"
  create_lane_database "$main_database_url" "$message_database"
  (cd "$WORKTREE_DIR" && uv sync --frozen && make migrate)

  # The seed must run under the lane's own .env — outside this subshell it
  # would write to the main checkout's databases.
  local seed_refusal seed_summary
  seed_refusal="$(lane_seed_refusal "$databases_are_new" "$SEED" "$WORKTREE_DIR/Makefile")"
  if [ -z "$seed_refusal" ]; then
    (cd "$WORKTREE_DIR" && make seed)
    seed_summary="seeded (reseed by tearing the lane down and setting it up again)"
  else
    echo "Skipping the development seed: $seed_refusal"
    seed_summary="skipped ($seed_refusal)"
  fi

  SUMMARY="$(cat <<EOF
  Dev database:     $development_database (test runs use test_$development_database)
  Message database: $message_database
  Redis/Celery:     $redis_base_url/$redis_index
  Seed:             $seed_summary
  Dev server:       uv run python manage.py runserver $development_server_port
EOF
)"
}

provision_engine_fork() {
  (cd "$WORKTREE_DIR" && corepack enable >/dev/null 2>&1 || true)
  (cd "$WORKTREE_DIR" && yarn install)
  SUMMARY="  Dependencies installed with yarn."
}

provision_python_venv() {
  local requirements_files=""
  for candidate in requirements-dev.txt requirements-test.txt requirements.txt; do
    [ -f "$WORKTREE_DIR/$candidate" ] && requirements_files="$requirements_files -r $candidate"
  done
  [ -n "$requirements_files" ] || return 0
  python3 -m venv "$WORKTREE_DIR/.venv"
  "$WORKTREE_DIR/.venv/bin/pip" install --quiet --upgrade pip
  (cd "$WORKTREE_DIR" && ./.venv/bin/pip install --quiet $requirements_files)
  SUMMARY="  Virtualenv at .venv ($(echo $requirements_files | sed 's/-r //g')). Activate with: source .venv/bin/activate"
}

provision_uv_project() {
  (cd "$WORKTREE_DIR" && uv sync --frozen 2>/dev/null || uv sync)
  SUMMARY="  Dependencies installed with uv sync."
}

if [ "$PROVISION" = true ]; then
  case "$REPO" in
    product-monolith) provision_product_monolith ;;
    engine-fork) provision_engine_fork ;;
    redirect-service|ingest-lambda-a|ingest-lambda-b) provision_python_venv ;;
    integration-lambdas)
      SUMMARY="  Lambdas install per directory: cd <lambda> && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt" ;;
    k3s-gateway) SUMMARY="  Go needs no provisioning: go build && go test ./..." ;;
    *)
      if [ -f "$WORKTREE_DIR/uv.lock" ]; then provision_uv_project
      elif ls "$WORKTREE_DIR"/requirements*.txt >/dev/null 2>&1; then provision_python_venv
      else SUMMARY="  No provisioning needed for this repo."
      fi ;;
  esac
fi

cat <<EOF

Worktree ready.
  Repo:             $REPO
  Lane:             $LANE
  Path:             $WORKTREE_DIR
  Branch:           $BRANCH (base $BASE)
$SUMMARY

Teardown when done: bash .claude/skills/worktrees/scripts/teardown.sh $REPO $LANE
EOF
