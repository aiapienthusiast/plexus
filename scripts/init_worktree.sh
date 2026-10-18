#!/usr/bin/env sh
# Initialize a freshly-created worktree.
#
# POSIX shell on purpose: bun is mise-managed, so it is not on PATH until
# `mise install` runs. This script bootstraps the toolchain (mise trust +
# mise install) and then runs the bun-based setup steps via `mise exec`
# so it works with or without activated mise shims. Keep it dependency-free
# beyond git + mise + sh so it runs before `bun install`.
set -eu

# Always operate from the worktree root regardless of caller cwd.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/.."

step() {
  label=$1
  shift
  printf '\n==> %s\n' "$label"
  printf '$'
  printf ' %s' "$@"
  printf '\n'
  "$@"
}

step 'Fetch latest main from origin' \
  git fetch origin main:refs/remotes/origin/main

step 'Rebase worktree onto origin/main' \
  git rebase origin/main

step 'Trust mise configuration' \
  mise trust

step 'Install project tools (bun, ...)' \
  mise install

step 'Install Bun dependencies' \
  mise exec -- bun install --frozen-lockfile

step 'Build frontend' \
  mise exec -- bun run build:frontend

# Project skills are vendored in .agents/skills (see skills-lock.json) so they are
# available the moment the worktree exists — no install step, no race with
# agents starting up. Freshness comes from the weekly CI refresh
# (.github/workflows/vendored-skills.yml), never from local mutation here.

printf '\nWorktree initialization complete.\n'
