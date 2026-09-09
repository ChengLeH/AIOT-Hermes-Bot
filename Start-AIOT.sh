#!/bin/sh
set -eu

AIOT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "AIOT requires Node.js 22.12+."
  printf '%s\n' "Install it from https://nodejs.org/en/download and run this file again."
  exit 1
fi

exec node "$AIOT_ROOT/scripts/aiot-bootstrap.mjs"
