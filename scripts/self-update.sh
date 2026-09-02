#!/usr/bin/env bash
# Self-update Cursor Agent from GitHub (origin/<branch>), then rebuild & restart.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${UPDATE_BRANCH:-main}"
SERVICE="${UPDATE_SERVICE:-app-cursor}"
LOG_DIR="$ROOT/data"
LOG_FILE="$LOG_DIR/update.log"
LOCK_FILE="$LOG_DIR/update.lock"
STATUS_FILE="$LOG_DIR/update.status"

mkdir -p "$LOG_DIR"
echo $$ >"$LOCK_FILE"
echo "running" >"$STATUS_FILE"

exec >>"$LOG_FILE" 2>&1

cleanup() {
  local code=$?
  if [[ $code -ne 0 ]]; then
    echo "failed" >"$STATUS_FILE"
    echo "ERROR: Update fehlgeschlagen (exit $code)"
  fi
  rm -f "$LOCK_FILE"
}
trap cleanup EXIT

echo ""
echo "======== $(date -Is) update start ========"
echo "root=$ROOT branch=$BRANCH service=$SERVICE pid=$$"

if [[ ! -d "$ROOT/.git" ]]; then
  echo "ERROR: kein Git-Repository"
  exit 1
fi

echo "fetch…"
git fetch --prune origin "$BRANCH"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
echo "local=$LOCAL"
echo "remote=$REMOTE"

if [[ "$LOCAL" == "$REMOTE" ]]; then
  echo "bereits aktuell"
  echo "uptodate" >"$STATUS_FILE"
  echo "======== $(date -Is) update skip ========"
  exit 0
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "ERROR: lokale Änderungen an getrackten Dateien — Update abgebrochen"
  git status --porcelain --untracked-files=no
  exit 1
fi

echo "reset --hard origin/$BRANCH"
git reset --hard "origin/$BRANCH"

# Datenbank-Backup vor Schema-Migrationen (beim nächsten Start)
if [[ -f "$ROOT/data/cursor.db" ]]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  cp -a "$ROOT/data/cursor.db" "$ROOT/data/cursor.db.bak-$STAMP"
  # WAL/SHM mitkopieren falls vorhanden
  [[ -f "$ROOT/data/cursor.db-wal" ]] && cp -a "$ROOT/data/cursor.db-wal" "$ROOT/data/cursor.db-wal.bak-$STAMP" || true
  [[ -f "$ROOT/data/cursor.db-shm" ]] && cp -a "$ROOT/data/cursor.db-shm" "$ROOT/data/cursor.db-shm.bak-$STAMP" || true
  echo "DB-Backup: data/cursor.db.bak-$STAMP"
  # Alte Backups begrenzen (max. 5)
  ls -1t "$ROOT/data"/cursor.db.bak-* 2>/dev/null | tail -n +6 | xargs -r rm -f
fi

echo "npm install…"
npm install --no-fund --no-audit

echo "npm run build…"
npm run build

echo "ok" >"$STATUS_FILE"
echo "restart $SERVICE…"
sleep 1
systemctl restart "$SERVICE"
echo "Hinweis: Schema-Migrationen laufen automatisch beim Start."
echo "======== $(date -Is) update done ========"
