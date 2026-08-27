#!/usr/bin/env bash

set -euo pipefail

# Only Docker needs path conversion disabled. Fabric's Windows binaries still
# need Git Bash to convert their configuration paths.
docker() {
  MSYS_NO_PATHCONV=1 COMPOSE_CONVERT_WINDOWS_PATHS=0 command docker "$@"
}

docker-compose() {
  MSYS_NO_PATHCONV=1 COMPOSE_CONVERT_WINDOWS_PATHS=0 command docker-compose "$@"
}

export -f docker
export -f docker-compose

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SAMPLES_DIR="$(cd "$PROJECT_ROOT/../work/fabric-samples" && pwd)"
TOOLS_DIR="$HOME/.blockclin-tools"

if [[ ! -x "$SAMPLES_DIR/bin/peer.exe" && ! -x "$SAMPLES_DIR/bin/peer" ]]; then
  echo "Fabric binaries are missing. Run install-fabric.sh docker binary from the work directory first."
  exit 1
fi

export PATH="$TOOLS_DIR:$PATH"
if ! command -v jq >/dev/null 2>&1; then
  mkdir -p "$TOOLS_DIR"
  JQ_DOWNLOAD_PATH="$(cygpath -am "$TOOLS_DIR/jq.exe")"
  echo "Downloading jq for the Fabric deployment helper..."
  curl --fail --location \
    --output "$JQ_DOWNLOAD_PATH" \
    https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-windows-amd64.exe
  chmod +x "$TOOLS_DIR/jq.exe"
fi

CHAINCODE_PATH="$(cygpath -am "$PROJECT_ROOT/blockchain/chaincode-provenance")"

cd "$SAMPLES_DIR/test-network"
./network.sh up createChannel -c blockclinchannel
./network.sh deployCC \
  -c blockclinchannel \
  -ccn provenance \
  -ccp "$CHAINCODE_PATH" \
  -ccl javascript

echo "BlockClin Fabric network and provenance chaincode are ready."
