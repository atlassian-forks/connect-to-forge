# Code Review: Bugs & Improvements

_A full-repository review of `connect-to-forge`, covering `src/`, tests, and project config. Each item below has a **severity**, the **evidence** (file + line), the **impact**, and a **proposed fix**. Items are ordered roughly by severity._

> Reviewed files: `src/index.ts`, `src/convert.ts`, `src/adoption-status.ts`, `src/types.ts`, the three test files, `package.json`, `tsconfig.json`, `webpack.config.js`, `README.md`, and the data fixtures.
>
> Baseline at review time: `yarn jest` → 85 passing; `tsc --noEmit` → clean.
>
> **Update:** bugs #1, #2, #4, and #5 have now been **FIXED** with accompanying tests (#3 is obsolete). The suite now has **100 tests, all passing**, and `tsc --noEmit` is clean. See each item below for the fix and its tests.

---

## 🐞 Bugs

### 1. Data-residency block clobbers previously-built `modules` — **HIGH** ✅ FIXED

**Where:** `src/convert.ts`, data-residency section (~line 240).

```ts
m.modules = {
  'migration:dataResidency': [ { key: 'dare', ... } ],
};
```

**Problem:** This is a full **reassignment** of `m.modules`, not a merge. Earlier in the same function, `m.modules` may already have been populated with:
- `jira:globalPermission` / `jira:projectPermission` (Jira permission modules, ~line 168-173), and
- Confluence unlicensed-access modules such as `macro`, `confluence:spacePage`, etc. (~line 186-193).

Any app that has **both** a permission/unlicensed module **and** `regionBaseUrls` will silently lose those native modules from the generated manifest.

**Fix:** Merge instead of overwrite:

```ts
if (!m.modules) m.modules = {};
m.modules['migration:dataResidency'] = [ { key: 'dare', ... } ];
```

**Fix applied:** `src/convert.ts` now does `if (!m.modules) m.modules = {}; m.modules['migration:dataResidency'] = [...]` (merge, not reassign).

**Tests:** `src/__tests__/convert.test.ts` → `data residency › regression: must not clobber previously-built native modules`. Two cases: (a) Jira descriptor with `jiraGlobalPermissions`/`jiraProjectPermissions` + `regionBaseUrls` retains `jira:globalPermission`/`jira:projectPermission`; (b) Confluence descriptor with `staticContentMacro` + `regionBaseUrls` retains the native `macro` module (with `unlicensedAccess`). Both now pass.

---

### 2. `loadExistingManifest` swallows *all* errors as "file not found" — **MEDIUM** ✅ FIXED

**Where:** `src/convert.ts` ~line 40-47.

```ts
try {
  const result = yaml.load(fs.readFileSync(outputFilename).toString('utf8'));
  return { found: true, manifest: result as ForgeManifest };
} catch (e) {
  return { found: false };
}
```

**Problem:** A malformed existing `manifest.yml` (invalid YAML) or a permissions error is indistinguishable from "no file present". The tool will then happily **overwrite** the user's broken-but-important file without warning. Only `ENOENT` should be treated as "not found".

**Fix:** Inspect the error — return `{ found: false }` only for `ENOENT`; for a YAML parse error or other I/O error, surface it to the user (and do not silently overwrite).

**Fix applied:** `loadExistingManifest` now returns a **no-throw discriminated union** — `LoadManifestResult` has four variants: `{ status: 'found', manifest }`, `{ status: 'missing' }`, `{ status: 'unreadable', error }`, and `{ status: 'unparseable', error }`. Only `ENOENT` maps to `missing`; other read errors map to `unreadable`; YAML parse failures map to `unparseable`. Because failures are returned as data (not thrown), the function stays pure and fully unit-testable, and the caller decides how to react. `runConvert` switches on `status`: `unreadable`/`unparseable` → print the error and exit without overwriting; `found` → merge/override flow; `missing` → create new.

**Tests:** `src/__tests__/load-existing-manifest.test.ts` — asserts each status variant (missing / found+parsed / unparseable+error / unreadable+error) and a `never throws, regardless of input` case. All pass.

---

### 3. `ACT_AS_USER` scope is not dropped/warned as specified — ~~**MEDIUM**~~ **OBSOLETE**

> **OBSOLETE (2026-07-27):** `ACT_AS_USER` is now supported on Forge, so the scope no longer needs to be dropped or warned about. The current pass-through normalisation is acceptable and no change is required. Retained here for the record.

**Where:** `src/convert.ts` scope handling ~line 228-231; original spec in `AGENTS.md` / `llm-prompt`.

**Original problem (no longer applicable):** The documented behaviour was that `ACT_AS_USER` should be dropped (with a warning) because it had no Forge equivalent. Every scope is normalised uniformly, so `ACT_AS_USER` becomes `act-as-user:connect-jira`. This was previously flagged as an invalid scope — but `ACT_AS_USER` now works, so this is no longer a bug.

---

### 4. `type` option is never validated — bad values silently produce a broken manifest — **MEDIUM** ✅ FIXED

**Where:** `src/index.ts` line 13 (`convert` command) + `src/convert.ts` line 352 (`opts.type as 'jira' | 'confluence'`).

**Problem:** `--type` is optional and unvalidated. If the user omits it or passes e.g. `--type Jira`, the `as 'jira' | 'confluence'` cast hides the problem at compile time, and at runtime scopes/modules get suffixed with `:connect-undefined` or `:connect-Jira`. The README and `usage()` imply `--type` is required.

**Fix applied:** Two layers of validation:
- CLI (`src/index.ts`): `--type` is now defined with Commander's `new Option(...).choices(['jira','confluence']).makeOptionMandatory()`, so Commander rejects missing/invalid values with a friendly error.
- Programmatic (`src/convert.ts`): a new exported `parseAppType()` normalises case and throws for `undefined`/unknown values; `runConvert` calls it and exits with a clear message. This also removes the unsafe `as` cast.

**Tests:** `src/__tests__/convert.test.ts` → `parseAppType()` — accepts `jira`/`confluence`, normalises case (`Jira` → `jira`), and throws for unknown types, `undefined`, and empty string. All pass.

---

### 5. `dataResidency.maxMigrationDurationHours` may serialise as `undefined` — **LOW** ✅ FIXED

**Where:** `src/convert.ts` ~line 246.

```ts
maxMigrationDurationHours: c.dataResidency?.maxMigrationDurationHours,
```

**Problem:** When `regionBaseUrls` is present but `dataResidency` is absent, this key is emitted with value `undefined`, which `js-yaml` renders (or drops) inconsistently and is not a valid Forge value.

**Fix:** Only include `maxMigrationDurationHours` when it is actually present (conditional spread), or provide a sensible default.

**Fix applied:** the module is now built with only `key`/`remote`/`path`, and `maxMigrationDurationHours` is added conditionally via `isPresent(c.dataResidency?.maxMigrationDurationHours)` — so the key never appears with an `undefined` value.

**Tests:** `src/__tests__/convert.test.ts` → `data residency › regression: maxMigrationDurationHours must not be undefined` — when `dataResidency` is absent, the key is not an own property and not in `Object.keys(entry)`; when `dataResidency: { maxMigrationDurationHours: 24 }` is provided, the value is `24`. All pass.

Note: `js-yaml` happens to drop `undefined` values on `dump()`, but the in-memory manifest object was still malformed (own property present) — any deep-equal, JSON serialisation, or alternative YAML dumper would have surfaced/emitted the invalid key. The fix removes the key entirely.

---

## 🔧 Improvements

### 6. Typo in E001 remediation string — **LOW (polish)** ✅ FIXED

**Where:** `src/adoption-status.ts` line 31.

**Fix applied:** the stray colon was removed — the string now reads `"Migrate these to native Forge modules, or remove them if no longer needed. ..."`.

---

### 7. Typo in `package.json` description — **LOW (polish)** ✅ FIXED

**Where:** `package.json` line 3.

**Fix applied:** the misspelled `Descritor` is gone; the description now reflects the multi-command CLI: `"Tools to help migrate Atlassian Connect apps to Forge: convert a Connect descriptor to a connect-on-forge manifest, and check your Forge adoption status."`

---

### 8. Enable stricter TypeScript & add a lint step — **MEDIUM**

**Where:** `tsconfig.json`, `package.json` scripts.

**Problem:** `strict` is on (good), but `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, and `noFallthroughCasesInSwitch` are all commented out. There is no linter (`eslint`) and no `typecheck` npm script, so type-only regressions can slip through CI (the build emits JS but `test` doesn't typecheck the way `--noEmit` would).

**Fix:** Turn on the extra strictness flags, add `eslint` + config, and add scripts:
```json
"typecheck": "tsc -p ./tsconfig.json --noEmit",
"lint": "eslint src --ext .ts"
```
Consider wiring these into a CI workflow.

---

### 9. `start-jira` / `start-conf` scripts are broken and inconsistent — **LOW** ✅ FIXED

**Where:** `package.json` lines 45-46.

**Problems:**
- They passed `--type jira --url <arg>` **without** the `convert` subcommand, so after the CLI was refactored to subcommands they no longer routed to `runConvert`.
- `--esm` conflicted with the CommonJS `tsconfig` (`module: commonjs`).

**Fix applied:** now `ts-node src/index.ts convert --type jira --url` and `ts-node src/index.ts convert --type confluence --url` (subcommand added, `--esm` dropped).

---

### 10. `runConvert` prints "will merge" before the user chooses Override — **LOW (UX)** ✅ FIXED

**Where:** `src/convert.ts`.

**Problem:** When an existing manifest with an `app.connect` section is found, the tool first printed *"Existing manifest detected, will merge your Connect Modules in."* and then immediately asked the user to **Override or Abort** (no merge actually happens on Override). The message was misleading.

**Fix applied:** the messaging is now scoped per branch:
- Existing file **with** `app.connect`: prints *"Existing ... file with an app.connect section detected."* then the Override/Abort prompt (no false "merge" claim).
- Existing file **without** `app.connect`: prints *"... will merge your Connect Modules in."* and actually performs the deep-merge.
- No existing file: prints *"... will create one."*

---

### 11. No test coverage for interactive / I/O wrappers — **MEDIUM**

**Where:** `src/__tests__/`.

**Problem:** The pure functions are well covered, but `runConvert`, `runAdoptionStatus`, and `downloadConnectDescriptor` still have no tests. (Coverage for the clobber scenario in #1 and `loadExistingManifest` in #2 has now been added as part of this review.)

**Fix:** Add focused tests for the remaining wrappers, e.g. mocking `axios` for `downloadConnectDescriptor`, and mocking `inquirer` + `fs` for `runConvert`/`runAdoptionStatus`.

---

## Status

- ✅ **Bugs fixed:** #1 (clobber), #2 (silent overwrite), #4 (`--type` validation), #5 (`undefined` duration key) — all with tests.
- ✅ **Improvements fixed:** #6 (E001 typo), #7 (`package.json` description), #9 (`start-*` scripts), #10 (merge messaging).
- ⏭️ **Obsolete:** #3 (`ACT_AS_USER` is now supported).
- 🔜 **Remaining (not yet done):** #8 (strictness/lint/CI), #11 (I/O wrapper test coverage).

Suite: **100 tests passing**, `tsc --noEmit` clean, `package.json` valid.

## Suggested Sequencing for the remaining improvements

1. **Test coverage:** #11 (wrap-level tests for `runConvert`/`runAdoptionStatus`/`downloadConnectDescriptor`).
2. **Foundation:** #8 (strictness/lint/CI) to catch future regressions.

Each remaining fix is small and localised; none require architectural change. The existing pure-function design (`buildForgeManifest`, `checkManifest`, `parseAppType`) makes almost all of these straightforward to cover with unit tests.
