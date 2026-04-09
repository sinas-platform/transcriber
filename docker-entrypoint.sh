#!/bin/sh
set -e

INDEX="/usr/share/nginx/html/index.html"

sed -i \
  -e "s|__VITE_DEFAULT_WORKSPACE_URL__|${VITE_DEFAULT_WORKSPACE_URL:-}|g" \
  "$INDEX"

exec nginx -g "daemon off;"
