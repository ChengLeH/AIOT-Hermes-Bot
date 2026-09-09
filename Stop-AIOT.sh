#!/bin/sh
set -eu

AIOT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$AIOT_ROOT/scripts/aiot-service.mjs" stop
