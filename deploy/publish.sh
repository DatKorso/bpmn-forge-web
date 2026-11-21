#!/bin/bash
set -euo pipefail
umask 022

site_root=/var/lib/bpmn-forge
repo=DatKorso/bpmn-forge-web

exec 9>"$site_root/.publish.lock"
flock -x 9

release="$(git ls-remote --exit-code "https://github.com/$repo.git" refs/heads/production-build | cut -f1)"
[[ "$release" =~ ^[0-9a-f]{40}$ ]]
previous="$(readlink "$site_root/current" || true)"
if [[ "$previous" == "releases/$release" ]]; then
  exit 0
fi

work="$(mktemp -d "$site_root/.deploy.XXXXXXXXXX")"
trap 'rm -rf -- "$work"' EXIT
trap 'exit 1' HUP INT TERM

mkdir "$work/site"
curl --fail --silent --show-error --connect-timeout 10 --max-time 60 \
  --output "$work/build.tar.gz" \
  "https://raw.githubusercontent.com/$repo/$release/bpmn-forge.tar.gz"
tar --extract --gzip --file="$work/build.tar.gz" --directory="$work/site" \
  --no-same-owner --no-same-permissions

if [[ -n "$(find "$work/site" ! -type f ! -type d -print -quit)" ||
      ! -s "$work/site/index.html" || ! -d "$work/site/assets" ]] ||
   ! grep -qxE '[0-9a-f]{40}' "$work/site/deployment-version.txt"; then
  echo 'Expected a Vite build with index.html, assets, and a source revision.' >&2
  exit 1
fi

mkdir -p "$site_root/releases"
if [[ ! -d "$site_root/releases/$release" ]]; then
  mv -T -- "$work/site" "$site_root/releases/$release"
fi
ln -s "releases/$release" "$work/current"
mv -Tf -- "$work/current" "$site_root/current"
printf 'Published source revision %s\n' "$(cat "$site_root/current/deployment-version.txt")"

find "$site_root/releases" -mindepth 1 -maxdepth 1 -type d -mtime +7 \
  ! -name "$release" ! -name "${previous##*/}" -exec rm -rf -- {} +
