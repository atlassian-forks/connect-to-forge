# Proposal 06: GitHub Release-Driven npm Versioning

## Status: Implemented

## Problem

Currently the `package.json` version (`2.0.0`) is hardcoded and must be manually
bumped before every publish. There is nothing stopping a developer from creating a
GitHub Release tagged `v2.1.0` while `package.json` still says `2.0.0`, causing npm
to publish the wrong version number.

The GitHub Release tag should be the single source of truth for the published version.

---

## Approach

When a GitHub Release is created with a tag like `v2.1.0`, the CI publish job should:

1. Extract the version from the git tag (strip the leading `v`)
2. Run `npm version <extracted-version> --no-git-tag-version` to update `package.json` in-place (without committing)
3. Then run `npm publish` as normal

This way:
- `package.json` never needs to be manually bumped before a release
- The published npm version always matches the GitHub Release tag exactly
- A mismatch is impossible — the tag *is* the version

---

## Implementation

### Changes to `.github/workflows/ci.yml`

Add a step in the `publish` job between "Install dependencies" and "Build webpack bundle":

```yaml
- name: Set version from release tag
  run: |
    # Strip the leading 'v' from the tag name (e.g. v2.1.0 → 2.1.0)
    VERSION=${GITHUB_REF_NAME#v}
    echo "Publishing version: $VERSION"
    npm version "$VERSION" --no-git-tag-version
```

`GITHUB_REF_NAME` is automatically set by GitHub Actions to the tag name (e.g. `v2.1.0`)
when the trigger is a release event. The `--no-git-tag-version` flag updates `package.json`
in memory only — it does not create a new git commit or tag.

The full updated `publish` job steps would be:

```yaml
publish:
  name: Publish to npm
  runs-on: ubuntu-latest
  needs: [ test, build-and-verify ]
  if: github.event_name == 'release' && github.event.action == 'created'
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

    - name: Install dependencies
      run: yarn install --frozen-lockfile

    - name: Set version from release tag
      run: |
        VERSION=${GITHUB_REF_NAME#v}
        echo "Publishing version: $VERSION"
        npm version "$VERSION" --no-git-tag-version

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

Note: the webpack build (`yarn prepack`) happens *after* the version bump so that
the version baked into the bundle (if ever referenced) is also correct.

---

## Tag naming convention

GitHub Release tags should follow the format `vMAJOR.MINOR.PATCH` (e.g. `v2.1.0`).
The leading `v` is stripped before passing to `npm version`.

Semver pre-release tags are also supported (e.g. `v2.1.0-beta.1` → `2.1.0-beta.1`).

---

## What stays the same

- `package.json` keeps a version field (currently `2.0.0`) as a reasonable default
  and for local `yarn install` / tooling. It just no longer needs to be bumped before
  every release — the CI step overrides it at publish time.
- The `test` and `build-and-verify` jobs are unchanged and still run in parallel as
  a gate before publishing.

---

## Effort estimate

- ~10 minutes — a single step added to the workflow file
- No test changes needed

---

## Open questions

- Should we add a validation step that asserts the tag is a valid semver string
  (e.g. `npx semver "$VERSION"`) to fail fast on malformed tags before publishing?
  This would be a nice guard but is optional.
