#!/usr/bin/env bash
# Stage demo: clean release, global duplicate block, challenge window, freeze.
set -euo pipefail
NET=testnet
CHALLENGE_SECS=${CHALLENGE_SECS:-45}
echo "Build with: stellar contract build"
echo "Set CHALLENGE_SECS=259200 for production (72 hours)."
echo "Deploy the generated target/wasm32v1-none/release/chainshield.wasm, then run the four calls documented in README.md."
