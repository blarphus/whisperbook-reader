#!/bin/bash
# Publishes tools/pipeline/pipeline.py and the alignment scripts to the private Kaggle dataset the site's jobs attach.
# Run this after changing pipeline.py, prepare_student_book.py or prepare_whispersync.py.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${KAGGLE_USERNAME:-josh123benja}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cp "$ROOT/tools/pipeline/pipeline.py" "$ROOT/scripts/prepare_student_book.py" "$ROOT/../prepare_whispersync.py" "$TMP/"
printf '{"title":"wb-tools","id":"%s/wb-tools","licenses":[{"name":"CC0-1.0"}]}' "$USER_NAME" > "$TMP/dataset-metadata.json"
if kaggle datasets status "$USER_NAME/wb-tools" 2>/dev/null | grep -qi ready; then
  kaggle datasets version -p "$TMP" -m "update $(date +%F)" 2>&1 | grep -v outdated
else
  kaggle datasets create -p "$TMP" 2>&1 | grep -v outdated
fi
