#!/bin/sh
set -eu

ASPNETCORE_URLS=http://127.0.0.1:8081 dotnet /app/api/Swarm.Api.dll &
api_pid=$!
ASPNETCORE_URLS=http://127.0.0.1:8082 dotnet /app/game/Swarm.GameServer.dll &
game_pid=$!

cleanup() {
  kill "$api_pid" "$game_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec nginx -g 'daemon off;'
