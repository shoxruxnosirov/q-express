#!/usr/bin/env bash
# Builds the newest commit on GitHub's main and switches the app over to it,
# the way Render's auto-deploy did. Run every two minutes by
# q-express-update.timer; by hand with --force to rebuild what is there.
#
# Each commit is built in a release folder of its own while the running one
# keeps serving, so a failed build changes nothing. The app is switched only
# once the build is done, and switched back if the new one does not answer.
# A build that fails is tried twice more (a download may just have broken
# off); after that, or once a version has failed to start, that commit is left
# alone until a newer one arrives.
#
# This runs as root, and everything it builds is written by the app user. So
# root never runs git or anything else from those folders, keeps its own state
# (the "current" link, the failure count) where the app user cannot write, and
# is never replaced by the copy in a release: setup.sh installs it.
set -euo pipefail

APP_USER=qexpress
APP_DIR=/opt/q-express
APP_HOME=/var/lib/q-express
REPO=$APP_DIR/repo
RELEASES=$APP_DIR/releases
ENV_FILE=/etc/q-express/env
PNPM_VERSION=10.33.0
KEEP=3
TRIES=3
PRUNE_DAYS=7

force=false
[[ ${1:-} == --force ]] && force=true

# One run at a time: a slow build must not overlap with the next tick.
exec 9>/run/q-express-update.lock
flock -n 9 || exit 0

as_app() {
  runuser -u $APP_USER -- env HOME=$APP_HOME PATH=/usr/local/bin:/usr/bin:/bin COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"
}
log() { echo "[update] $*"; }
setting() { sed -n "s/^$1=//p" $ENV_FILE | tail -1; }

as_app git -C $REPO fetch --quiet origin main
target=$(as_app git -C $REPO rev-parse origin/main)
[[ $target =~ ^[0-9a-f]{40}$ ]] || { log "no commit found on main"; exit 1; }
current=$(readlink -f $APP_DIR/current 2>/dev/null || true)
current_commit=
[[ -n $current ]] && current_commit=$(as_app cat "$current/.commit" 2>/dev/null || true)

# How many times this commit has failed: the failed file holds "<commit> <n>".
failures() {
  local commit n
  if [[ -f $APP_DIR/failed ]] && read -r commit n < $APP_DIR/failed && [[ $commit == "$target" ]]; then
    echo "${n:-$TRIES}"
  else
    echo 0
  fi
}

if ! $force; then
  [[ $target == "$current_commit" ]] && exit 0
  (( $(failures) >= TRIES )) && exit 0
fi

short=${target:0:7}
release=$RELEASES/$(date +%Y%m%d-%H%M%S)-$short
log "building $short"
fail() {
  local n=$(( $(failures) + 1 ))
  echo "$target $n" > $APP_DIR/failed
  rm -rf "$release"
  if (( n < TRIES )); then
    log "build of $short failed (try $n of $TRIES); the running version stays, trying again shortly"
  else
    log "build of $short failed $n times; the running version stays until a newer commit"
  fi
  exit 1
}

# Chained with && throughout: under "|| fail" bash ignores set -e, so a step
# that fails would otherwise let the next one run.
build() {
  install -d -o $APP_USER -g $APP_USER "$release" &&
  as_app bash -c "set -o pipefail; git -C $REPO archive $target | tar -x -C '$release'" &&
  echo "$target" | as_app tee "$release/.commit" >/dev/null &&
  cd "$release" &&
  as_app corepack prepare pnpm@$PNPM_VERSION --activate >/dev/null &&
  as_app pnpm install --frozen-lockfile --reporter=append-only &&
  as_app env PORT=5000 BASE_PATH=/ pnpm --filter @workspace/qorasuv-express run build &&
  # Also applies the database migrations, as Render's build did. The address
  # is read from the settings file inside, so it never shows in the process
  # list the way a command-line argument would.
  as_app bash -c "export DATABASE_URL=\"\$(sed -n 's/^DATABASE_URL=//p' $ENV_FILE | tail -1)\" &&
    exec pnpm --filter @workspace/api-server run build"
}
build || fail
cd /

switch_to() {
  ln -sfn "$1" $APP_DIR/current.next
  mv -T $APP_DIR/current.next $APP_DIR/current
  systemctl restart q-express
  # The settings the app now runs with, so setup.sh restarts only for a change.
  sha256sum < $ENV_FILE > $APP_DIR/env.sha
}
# Up to a minute for the app to answer.
answers() {
  for _ in $(seq 1 30); do
    sleep 2
    curl -fs -o /dev/null "http://127.0.0.1:$(setting PORT)/api/healthz" && return 0
  done
  return 1
}

log "starting $short"
switch_to "$release"

if ! answers; then
  # Not tried again: every try would take the site down for a minute.
  log "$short does not answer; going back"
  echo "$target $TRIES" > $APP_DIR/failed
  if [[ -n $current ]]; then
    switch_to "$current"
    # Not kept with the releases to go back to by hand: it is one that fails.
    rm -rf "$release"
    if answers; then log "back on ${current_commit:0:7}"; else log "${current_commit:0:7} does not answer either"; fi
  fi
  exit 1
fi

rm -f $APP_DIR/failed
log "$short is live"

# The newest few releases stay, so going back by hand is a symlink away. Only
# real folders root made here are removed; rm does not follow links inside them.
ls -1 $RELEASES | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  old=$RELEASES/$old
  if [[ -d $old && ! -L $old && $(readlink -f "$old") != "$release" ]]; then rm -rf "$old"; fi
done

# The pnpm store keeps every package version ever installed; now and then the
# ones no release uses any more are let go.
if [[ -z $(find $APP_DIR/pruned -mtime -$PRUNE_DAYS 2>/dev/null) ]]; then
  log "pruning the package store"
  (cd "$release" && as_app pnpm store prune >/dev/null 2>&1) || log "pruning failed (harmless)"
  touch $APP_DIR/pruned
fi
