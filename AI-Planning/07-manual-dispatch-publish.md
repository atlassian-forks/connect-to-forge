# Proposal 07: Manual Workflow Dispatch for npm Publishing

## Status: Implemented

## Context

Proposal 06 attempted to use GitHub Release events to trigger publishing. This was
found to be incompatible with the Atlassian Artifactory Tokenator (`artifact-publish-token`
action), which **only issues a write token when the workflow runs on the `main` or
`master` branch**. GitHub Releases run against a tag ref (e.g. `refs/tags/v2.0.0`),
which Tokenator sees as a non-release branch and returns a read-only token — causing
a `403 Forbidden` on publish.

Reference: https://hello.atlassian.net/wiki/spaces/PRODSEC/pages/2255564718/

The Artifacts team (Julio Rincon) confirmed this and noted a feature request has
been raised to potentially support tag-based write tokens in the future, but that
is not available today.

---

## Problem

We need a way to:
1. Merge changes into `main` normally (tests run on every PR and push as today)
2. Publish to npm **on demand** — only when we choose to — without automatic triggers
3. Have the publish job run on `main` so Tokenator grants a write token
4. Use the version from `package.json` as the published version (no tag extraction needed)

---

## Solution: `workflow_dispatch` on main

GitHub Actions supports a `workflow_dispatch` trigger that adds a **"Run workflow"
button** in the GitHub Actions UI. It can be restricted to run only on `main`.

The workflow will:
1. Be triggered manually via the GitHub Actions UI (or the `gh` CLI)
2. Check out `main`
3. Run tests and build in parallel as a gate
4. If both pass, publish to npm using the version in `package.json`

Since the checkout is from `main`, Tokenator issues a write token and the publish succeeds.

---

## Workflow design

Replace the current `release` trigger with `workflow_dispatch`. The publish job
becomes a separate, independently-dispatchable job (not gated on a PR event):

```yaml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
  workflow_dispatch:
    # No inputs required — version comes from package.json

permissions:
  contents: read

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Use Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18.x'
          cache: 'yarn'
      - run: yarn install --frozen-lockfile
      - run: yarn test

  build-and-verify:
    name: Build and Verify npx
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Use Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18.x'
          cache: 'yarn'
      - run: yarn install --frozen-lockfile
      - run: yarn prepack
      - name: Pack and verify npx
        run: |
          npm pack
          npx --yes $(ls *.tgz) --help

  publish:
    name: Publish to npm
    runs-on: ubuntu-latest
    needs: [ test, build-and-verify ]
    # Only run when manually dispatched — not on every push or PR
    if: github.event_name == 'workflow_dispatch'
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v3

      - name: Use Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18.x'
          registry-url: 'https://packages.atlassian.com/api/npm/npm-public/'
          cache: 'yarn'

      - run: yarn install --frozen-lockfile

      - name: Build webpack bundle
        run: yarn prepack

      - name: Get Artifact Publish Token
        id: publish-token
        uses: atlassian-labs/artifact-publish-token@v1.0.1
        with:
          output-modes: npm

      - name: Publish to npm
        run: npm publish --userconfig=./.npmrc-public --@atlassian/connect-to-forge:registry="https://packages.atlassian.com/api/npm/npm-public/"
```

---

## Publishing workflow (developer steps)

1. Bump the version in `package.json` on a branch, open a PR, merge to `main`
2. Go to **https://github.com/atlassian-forks/connect-to-forge/actions/workflows/ci.yml**
3. Click **"Run workflow"** → select `main` → click **"Run workflow"**
4. The `test` and `build-and-verify` jobs run in parallel
5. If both pass, `publish` runs on `main` — Tokenator issues a write token — npm publish succeeds

Or via the CLI:
```bash
gh workflow run ci.yml --repo atlassian-forks/connect-to-forge --ref main
```

---

## What changes from Proposal 06

- **Remove** the `release: types: [created]` trigger
- **Add** `workflow_dispatch:` trigger (no inputs needed)
- **Change** the publish job condition from `github.event_name == 'release' && github.event.action == 'created'` to `github.event_name == 'workflow_dispatch'`
- **Remove** the "Set version from release tag" step (version comes from `package.json` directly)
- Proposal 06's PR (#4) should be closed/abandoned in favour of this approach

---

## What does NOT change

- `test` and `build-and-verify` still run on every push and PR to `main`
- The `publish` job still requires both to pass before running
- The Artifactory Tokenator setup is unchanged
- `package.json` version is still the source of truth — just bumped manually in a PR before publishing

---

## Tradeoffs

| Aspect | This approach | Proposal 06 (GitHub Release) |
|---|---|---|
| Tokenator write token | ✅ Works (runs on main) | ❌ Fails (runs on tag) |
| Accidental publish prevention | ✅ Manual button press required | ✅ Only on release creation |
| Version source of truth | `package.json` (PR bump) | Git tag |
| Audit trail | GitHub Actions run log | GitHub Release page |
| Simplicity | ✅ Simple | ✅ Simple |

---

## Effort estimate

- ~5 minutes — remove `release` trigger, add `workflow_dispatch`, update `if` condition, remove version-extraction step
