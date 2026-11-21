#!/bin/bash
set -euo pipefail
umask 022

if [[ "${SSH_ORIGINAL_COMMAND:-}" != 'bpmn-forge-publish' ]]; then
  echo 'Expected SSH command: bpmn-forge-publish' >&2
  exit 1
fi

site_root=/var/www/bpmn-forge-web

# Serialize publication even if an SSH session outlives its workflow job.
exec 9>"$site_root/.publish.lock"
flock -x 9

work="$(mktemp -d "$site_root/.deploy.XXXXXXXXXX")"
trap 'rm -rf -- "$work"' EXIT
trap 'exit 1' HUP INT TERM

mkdir "$work/site"
tar --extract --gzip --file=- --directory="$work/site" \
  --no-same-owner --no-same-permissions

if [[ ! -s "$work/site/index.html" || ! -d "$work/site/assets" ]] ||
  [[ -n "$(find "$work/site" ! -type f ! -type d -print -quit)" ]]; then
  echo 'Expected a Vite build with index.html, assets, and regular files only.' >&2
  exit 1
fi

release="${work##*.}"
mv -T -- "$work/site" "$site_root/releases/$release"
ln -s "releases/$release" "$work/current"
# The staging directory and the link are on the same filesystem.
mv -Tf -- "$work/current" "$site_root/current"
printf 'Published release %s\n' "$release"
