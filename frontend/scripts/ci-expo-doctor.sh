#!/usr/bin/env bash
# CI-friendly Expo Doctor wrapper.
# Fails on real project issues (duplicates, SDK mismatches, package.json problems).
# Ignores remote-only schema/directory API failures (exp.host / reactnative.directory).
set -uo pipefail

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

set +e
npx expo-doctor --verbose >"$LOG" 2>&1
CODE=$?
set -e
cat "$LOG"

if [[ "$CODE" -eq 0 ]]; then
  exit 0
fi

fail=0
while IFS= read -r line; do
  case "$line" in
    "✖ Check that no duplicate dependencies are installed"*)
      fail=1
      ;;
    "✖ Check that packages match versions required by installed Expo SDK"*)
      fail=1
      ;;
    "✖ Check package.json for common issues"*)
      fail=1
      ;;
    "✖ Check dependencies for packages that should not be installed directly"*)
      fail=1
      ;;
    "✖ Check for common project setup issues"*)
      fail=1
      ;;
    "✖ Check Expo config for common issues"*)
      fail=1
      ;;
  esac
done <"$LOG"

if [[ "$fail" -eq 1 ]]; then
  echo "ci-expo-doctor: failing on project issues above"
  exit 1
fi

if grep -qE '✖ Check Expo config \(app\.json/ app\.config\.js\) schema|✖ Validate packages against React Native Directory' "$LOG"; then
  echo "ci-expo-doctor: ignoring remote Expo schema/directory check failures"
fi

exit 0
