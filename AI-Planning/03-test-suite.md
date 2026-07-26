# Proposal: Comprehensive Test Suite for connect-to-forge

## Overview

This proposal describes the testing strategy, required refactoring, and test coverage plan for the `connect-to-forge` CLI tool. The goal is a test suite that covers all business logic independently of CLI execution, network calls, file I/O, and interactive prompts.

---

## Current Testability Assessment

~~Only **two** of the eight exported functions are currently pure and testable in isolation~~ — after initial refactoring, four are now testable:

| Function | File | Testable now? | Reason |
|---|---|---|---|
| `genDefaultManifest()` | `convert.ts` | ✅ Yes | Pure function |
| `checkManifest()` | `adoption-status.ts` | ✅ Yes | Pure function |
| `parseManifest()` | `adoption-status.ts` | ✅ Yes | Extracted from `runAdoptionStatus()` — YAML parsing separated from file I/O |
| `downloadConnectDescriptor()` | `convert.ts` | ❌ No | Hardcoded axios + process.exit |
| `loadExistingManifest()` | `convert.ts` | ❌ No | Hardcoded fs + console.log |
| `convertToForgemanifest()` | `convert.ts` | ❌ No | Inquirer prompts tangled with logic |
| `runConvert()` | `convert.ts` | ❌ No | Full I/O orchestrator |
| `printAdoptionStatus()` | `adoption-status.ts` | ❌ No | Hardcoded console.log |
| `runAdoptionStatus()` | `adoption-status.ts` | ✅ Partially | File I/O still present but YAML parsing extracted |

The core problem is that **business logic is tangled with I/O**. The fix is to extract pure functions for all business logic and inject I/O dependencies, making them testable without mocking the file system, network, or terminal.

---

## Proposed Refactoring for Testability

Before writing tests, the following targeted refactoring is needed. These changes are **additive** — they do not change the observable CLI behaviour, only the internal structure.

| # | Refactoring | Status |
|---|---|---|
| 1 | Extract `buildForgeManifest()` from `convertToForgemanifest()` | ❌ Not done |
| 2 | Extract `normaliseConnectScope()` | ❌ Not done |
| 3 | Extract `normalisePermission()` and `assignWebhookKeys()` | ❌ Not done |
| 4 | Make `loadExistingManifest()` return a result type | ❌ Not done |
| 5 | Make `printAdoptionStatus()` accept a writer | ❌ Not done |
| — | Extract `parseManifest()` from `runAdoptionStatus()` | ✅ Done |

### 1. Extract pure conversion logic from `convertToForgemanifest()`

Currently `convertToForgemanifest()` contains the core manifest-building logic but also fires two `inquirer.prompt()` calls (for the data-residency migration path and egress operations). 

**Proposed change:** Extract the core transformation into a pure function `buildForgeManifest()` that accepts all decisions as parameters instead of prompting the user for them:

```typescript
// New pure function — fully testable
export function buildForgeManifest(
  manifest: ForgeManifest,
  connect: ConnectDescriptor,
  type: 'jira' | 'confluence',
  options: {
    migrationPath?: string;       // replaces the inquirer prompt for dare-migration
    egressOperations?: string[];  // replaces the inquirer checkbox
    inScopeEUD?: boolean;         // replaces the inquirer confirm
  }
): { manifest: ForgeManifest; warnings: string[] }

// convertToForgemanifest() becomes a thin orchestrator:
// 1. Prompt user for options
// 2. Call buildForgeManifest() with those options
// 3. Return result
```

### 2. Extract scope conversion logic

The scope normalisation (`scope.toLowerCase().replace(/_/g, '-') + ':connect-' + type`) is a pure transformation currently inlined in `convertToForgemanifest()`. Extract it:

```typescript
// New pure function
export function normaliseConnectScope(scope: string, type: 'jira' | 'confluence'): string
```

### 3. Extract module migration logic

The logic that decides whether a Connect module type goes to `connectModules` or `modules` (the `CONFLUENCE_MODULES_WITH_UNLICENSED_ACCESS` map, the permission normalisation, the webhook key generation) should be extracted into pure functions:

```typescript
export function migrateModules(
  connect: ConnectDescriptor,
  type: 'jira' | 'confluence'
): { connectModules: Record<string, any>; nativeModules: Record<string, any>; warnings: string[] }

export function normalisePermission(permission: any): any

export function assignWebhookKeys(webhooks: any[]): any[]
```

### 4. Make `loadExistingManifest()` return a result instead of logging

```typescript
// Current: logs to console and returns ForgeManifest | null
// Proposed: returns a discriminated union
export type LoadManifestResult =
  | { found: true; manifest: ForgeManifest }
  | { found: false };

export function loadExistingManifest(outputFilename: string): LoadManifestResult
// Callers handle the console.log themselves
```

### 5. Make `printAdoptionStatus()` accept a writer

```typescript
// Current: hardcoded console.log
export function printAdoptionStatus(result: AdoptionStatusResult): void

// Proposed: injectable writer for testability
export function printAdoptionStatus(
  result: AdoptionStatusResult,
  write: (line: string) => void = console.log
): void
```

---

## Test Framework

> **Note:** The proposal originally suggested Vitest, but **Jest + ts-jest** was used instead as it integrates cleanly with the existing CommonJS TypeScript setup. The test API is compatible — `describe`, `it`, `expect` are identical.

**Framework:** [Jest](https://jestjs.io/) + [ts-jest](https://kulshekhar.github.io/ts-jest/) — ✅ installed and configured

**Mocking:** Jest's built-in `jest.mock()` and `jest.fn()` for any remaining I/O that cannot be extracted (axios, fs in integration tests).

**Test file location:**
```
connect-to-forge/src/
├── __tests__/
│   ├── adoption-status.test.ts   ✅ Done — unit tests for checkManifest(), parseManifest()
│   ├── convert.test.ts            ❌ Not done — unit tests for buildForgeManifest(), normaliseConnectScope(), etc.
│   ├── manifest-fixtures.ts       ❌ Not done — shared ForgeManifest/ConnectDescriptor fixture objects
│   └── integration.test.ts        ❌ Not done — end-to-end CLI tests using child_process
```

---

## Test Coverage Plan

### `src/__tests__/adoption-status.test.ts`

All tests against `checkManifest()` — currently pure, no mocking needed.

#### `checkManifest()` — Error rules

| Test | Input | Expected |
|---|---|---|
| E001: non-empty connectModules | manifest with `connectModules: { 'jira:webhooks': [...] }` | `errors` contains E001; `moduleTypes` in detail |
| E001: counts modules correctly | manifest with 3 module types, varying array lengths | E001 detail shows correct counts per type |
| E001: lifecycle module triggers specific note | `connectModules: { 'jira:lifecycle': [...] }` | E001 present; remediation mentions Option 2 / Forge trigger |
| E002: extra fields in app.connect | `app.connect: { key: 'x', remote: 'connect' }` | errors contains E002; extraFields: ['remote'] |
| E002: multiple extra fields | `app.connect: { key: 'x', remote: 'y', authentication: 'jwt' }` | E002 detail lists both extra fields |
| E002: key-only app.connect is clean | `app.connect: { key: 'x' }` | no E002 |
| E003: app.connect missing entirely | manifest with no `app.connect` | errors contains E003 |
| E003: app.connect.key missing | `app.connect: { remote: 'connect' }` | errors contains E003 |
| E003: app.connect.key present | `app.connect: { key: 'com.example.app' }` | no E003 |
| E004: Connect-style jira scopes | `permissions.scopes: ['read:connect-jira']` | errors contains E004; scope listed in detail |
| E004: Connect-style confluence scopes | `permissions.scopes: ['write:connect-confluence']` | errors contains E004 |
| E004: native Forge scopes are clean | `permissions.scopes: ['read:jira-work']` | no E004 |
| E004: mixed scopes — only Connect ones flagged | `['read:jira-work', 'read:connect-jira']` | E004 detail contains only `read:connect-jira` |
| No errors at all | clean manifest | `fullyAdopted: true`; `errors: []` |

#### `checkManifest()` — Warning rules

| Test | Input | Expected |
|---|---|---|
| W001: empty connectModules | `connectModules: {}` | warnings contains W001 |
| W001: no connectModules key | manifest without connectModules | no W001 |
| W002: placeholder app ID | `app.id: 'ari:cloud:ecosystem::app/invalid-run-forge-register'` | warnings contains W002 |
| W002: real app ID | `app.id: 'ari:cloud:ecosystem::app/real-id'` | no W002 |
| W003: URL token in connectModules | module with `url: '/panel?issue_key={issue.key}'` | warnings contains W003 |
| W003: URL token in native modules | native module with Connect-style token | warnings contains W003 |
| W003: no tokens | clean URLs | no W003 |

#### `checkManifest()` — Adoption summary

| Test | Input | Expected |
|---|---|---|
| Fully adopted summary | clean manifest | `summary` contains "fully adopted" |
| Zero adoption summary | connectModules present, no native modules | `summary` mentions "no modules or scopes have been migrated" |
| Partial adoption summary | connectModules present AND native modules present | `summary` contains "partially adopted" |

#### `printAdoptionStatus()` — Output format

| Test | Input | Expected output |
|---|---|---|
| Fully adopted — shows checkmarks | `fullyAdopted: true`, no issues | output contains all four `✓` lines |
| Error displayed with correct symbol | result with one E001 error | output contains `✗ [E001]` |
| Warning displayed with correct symbol | result with one W002 warning | output contains `⚠ [W002]` |
| E001 detail lines shown | E001 with formatted module list | each module type shown on its own line |
| E004 scope lines shown | E004 with scopes | each scope shown on its own line |
| Adoption summary always shown | any result | output contains the summary string |
| Error/warning count shown when issues present | result with 2 errors, 1 warning | output contains "2 error(s), 1 warning(s)" |
| Migration link shown when issues present | result with errors | output contains the docs URL |
| Migration link not shown when fully adopted | `fullyAdopted: true` | output does NOT contain docs URL |

---

### `src/__tests__/convert.test.ts`

After the refactoring above, these test the extracted pure functions.

#### `genDefaultManifest()` — currently pure, testable now

| Test | Input | Expected |
|---|---|---|
| Sets app.connect.key from descriptor | `connect.key: 'com.example.app'` | `manifest.app.connect.key === 'com.example.app'` |
| Sets app.connect.remote to 'connect' | any descriptor | `manifest.app.connect.remote === 'connect'` |
| Sets remotes[0].baseUrl from descriptor | `connect.baseUrl: 'https://x.com'` | `manifest.remotes[0].baseUrl === 'https://x.com'` |
| Sets remotes[0].key to 'connect' | any descriptor | `manifest.remotes[0].key === 'connect'` |
| Sets placeholder app ID | any descriptor | `manifest.app.id === 'ari:cloud:ecosystem::app/invalid-run-forge-register'` |
| Sets runtime to nodejs20.x | any descriptor | `manifest.app.runtime.name === 'nodejs20.x'` |
| Returns empty connectModules | any descriptor | `manifest.connectModules` is `{}` |
| Returns empty permissions.scopes | any descriptor | `manifest.permissions.scopes` is `[]` |

#### `normaliseConnectScope()` — after extraction

| Test | Input | Expected |
|---|---|---|
| Lowercases scope | `'READ', 'jira'` | `'read:connect-jira'` |
| Replaces underscores with dashes | `'PROJECT_ADMIN', 'jira'` | `'project-admin:connect-jira'` |
| Appends correct type suffix | `'read', 'confluence'` | `'read:connect-confluence'` |
| Already lowercase scope | `'write', 'jira'` | `'write:connect-jira'` |

#### `normalisePermission()` — after extraction

| Test | Input | Expected |
|---|---|---|
| Flattens name object | `{ name: { value: 'My Perm' } }` | `{ name: 'My Perm', migratedFromConnect: true }` |
| Flattens description object | `{ description: { value: 'Desc' } }` | `{ description: 'Desc', migratedFromConnect: true }` |
| Leaves string name unchanged | `{ name: 'My Perm' }` | `{ name: 'My Perm', migratedFromConnect: true }` |
| Adds migratedFromConnect flag | any permission | `migratedFromConnect: true` |

#### `assignWebhookKeys()` — after extraction

| Test | Input | Expected |
|---|---|---|
| Assigns sequential keys | 3 webhooks | keys are 'webhook-1', 'webhook-2', 'webhook-3' |
| Does not mutate event/url fields | webhook with event/url | those fields unchanged |
| Single webhook | 1 webhook | key is 'webhook-1' |
| Empty array | `[]` | returns `[]` |

#### `buildForgeManifest()` — after extraction (the big one)

| Test | Area | Input | Expected |
|---|---|---|---|
| Lifecycle events moved to connectModules | lifecycle | descriptor with `installed`, `uninstalled` | `connectModules['jira:lifecycle'][0]` has both, with `key: 'lifecycle-events'` |
| dare-migration excluded from lifecycle | lifecycle | descriptor with `dare-migration` | lifecycle module does NOT contain `dare-migration` |
| enableLicensing mapped | licensing | `enableLicensing: true` | `manifest.app.licensing.enabled === true` |
| enableLicensing: false | licensing | `enableLicensing: false` | `manifest.app.licensing.enabled === false` |
| editionsEnabled mapped | licensing | `editionsEnabled: true` | `manifest.app.licensing.editionsEnabled === true` |
| jiraGlobalPermissions migrated to native | Jira perms | `modules.jiraGlobalPermissions: [...]` | in `modules['jira:globalPermission']`, not in connectModules |
| jiraProjectPermissions migrated to native | Jira perms | `modules.jiraProjectPermissions: [...]` | in `modules['jira:projectPermission']`, not in connectModules |
| Confluence staticContentMacro → macro | Confluence | `modules.staticContentMacro: [...]` | `modules.macro` contains entry with `unlicensedAccess: ['unlicensed', 'anonymous']` |
| Confluence dynamicContentMacro → macro | Confluence | `modules.dynamicContentMacro: [...]` | merged into same `modules.macro` array |
| Both macro types merge into one array | Confluence | both static and dynamic macros | `modules.macro` contains entries from both |
| Non-unlicensed Confluence module → connectModules | Confluence | `modules.generalPages: [...]` | in `connectModules['confluence:generalPages']` |
| Jira module → connectModules | Jira | `modules.webPanels: [...]` | in `connectModules['jira:webPanels']` |
| Singleton module wrapped in array | modules | `modules.someModule: {}` (not array) | stored as `[{}]` |
| Webhook keys assigned | webhooks | `modules.webhooks: [{event: 'x', url: 'y'}, ...]` | keys are 'webhook-1', 'webhook-2' |
| Scopes normalised for Jira | scopes | `scopes: ['READ', 'PROJECT_ADMIN']` | `permissions.scopes: ['read:connect-jira', 'project-admin:connect-jira']` |
| Scopes normalised for Confluence | scopes | `scopes: ['WRITE']` | `permissions.scopes: ['write:connect-confluence']` |
| Translations moved to connectModules | translations | `translations.paths: { en: '/en' }` | `connectModules['jira:translations'][0]` present |
| cloudAppMigration moved | migration | `cloudAppMigration.migrationWebhookPath: '/webhook'` | `connectModules['jira:cloudAppMigration'][0]` present |
| Data residency — migration module created | DARE | descriptor with `regionBaseUrls` + `dare-migration` lifecycle | `modules['migration:dataResidency']` present with correct path |
| Data residency — warning when no dare-migration | DARE | descriptor with `regionBaseUrls`, no `dare-migration` | warning about missing lifecycle hook |
| Data residency — region URLs in remote | DARE | descriptor with `regionBaseUrls: { EU: 'https://eu...' }` | `remotes[0].baseUrl` is a map with `default` and `EU` keys |
| Data residency — inScopeEUD set when storage | DARE | `egressOperations: ['storage']`, `inScopeEUD: true` | `remotes[0].storage.inScopeEUD === true` |
| Empty modules object removed | cleanup | all modules become native | no `modules` key in output |
| Unsupported module warning | warnings | module in UNSUPPORTED_MODULES set | warning emitted |

---

### `src/__tests__/integration.test.ts`

End-to-end tests that invoke the built CLI as a child process. These are **slower** and should be tagged separately (e.g. `vitest run --reporter=verbose` with a separate config or `describe.skip` in fast mode).

| Test | Command | Expected |
|---|---|---|
| `adoption-status` on fully-adopted manifest | `node dist/index.js adoption-status --manifest <fixture>` | exit 0; stdout contains "fully adopted" |
| `adoption-status` on Connect descriptor | `node dist/index.js adoption-status --manifest my-reminders.json` | exit 0; stdout contains E003 |
| `adoption-status --strict` on unclean manifest | `--strict` flag | exit 1 |
| `adoption-status --strict` on clean manifest | `--strict` flag | exit 0 |
| `adoption-status --json` output is valid JSON | `--json` flag | stdout parses as JSON; has `fullyAdopted` field |
| `adoption-status --manifest missing.yml` | non-existent file | exit 1; stderr contains error message |
| `adoption-status --help` | `--help` | exit 0; stdout contains option descriptions |
| `convert --help` | `--help` | exit 0; stdout contains `--url`, `--type`, `--output` |
| Top-level `--help` | `node dist/index.js --help` | exit 0; lists both subcommands |

---

## Test Fixtures (`src/__tests__/manifest-fixtures.ts`)

A shared module exporting reusable test objects:

```typescript
export const cleanForgeManifest: ForgeManifest = {
  app: { id: 'ari:cloud:ecosystem::app/real', connect: { key: 'com.example.app' }, runtime: { name: 'nodejs20.x' } },
  permissions: { scopes: ['read:jira-work'] }
};

export const connectOnForgeManifest: ForgeManifest = {
  app: { id: 'ari:cloud:ecosystem::app/invalid-run-forge-register', connect: { key: 'com.example.app', remote: 'connect' }, runtime: { name: 'nodejs20.x' } },
  connectModules: { 'jira:webPanels': [{ key: 'panel', url: '/panel' }] },
  remotes: [{ key: 'connect', baseUrl: 'https://example.com' }],
  permissions: { scopes: ['read:connect-jira'] }
};

export const minimalConnectDescriptor: ConnectDescriptor = {
  name: 'Test App', key: 'com.example.test', baseUrl: 'https://example.com',
  scopes: ['READ'], modules: {}
};

// ... additional fixtures for lifecycle, data residency, Confluence macros, etc.
```

---

## Setup Steps

```bash
# 1. Add Jest and test dependencies  ✅ Done
npm install --save-dev jest ts-jest @types/jest

# 2. Add test script to package.json  ✅ Done
"scripts": {
  "test": "jest"
},
"jest": {
  "preset": "ts-jest",
  "testEnvironment": "node",
  "testMatch": ["**/src/__tests__/**/*.test.ts"]
}
```

---

## Scope & Effort Estimate

| Task | Effort | Status |
|---|---|---|
| Add Jest + configure | Small (30 min) | ✅ Done |
| Extract `parseManifest()` from `runAdoptionStatus()` | Small (30 min) | ✅ Done |
| Write adoption-status.test.ts (25 tests) | Medium (2–3 hours) | ✅ Done |
| Create manifest-fixtures.ts | Small (1 hour) | ❌ Not done |
| Extract `normaliseConnectScope()` | Small (30 min) | ❌ Not done |
| Extract `normalisePermission()` | Small (30 min) | ❌ Not done |
| Extract `assignWebhookKeys()` | Small (30 min) | ❌ Not done |
| Extract `buildForgeManifest()` (biggest refactor) | Medium (3–4 hours) | ❌ Not done |
| Refactor `loadExistingManifest()` | Small (1 hour) | ❌ Not done |
| Make `printAdoptionStatus()` accept writer | Small (30 min) | ❌ Not done |
| Write convert.test.ts (~35 tests) | Medium (3–4 hours) | ❌ Not done |
| Write integration.test.ts (~9 tests) | Small (1–2 hours) | ❌ Not done |
| **Total** | **~14–18 hours** | **~3 hours complete** |

---

## Open Questions

1. **Coverage threshold** — What minimum coverage % should be enforced? 80% is a reasonable starting point for a project of this size.

2. **Integration test speed** — Integration tests require a `dist/` build. Should they be a separate script (`test:integration`) to keep the fast unit test loop clean?

3. **Inquirer mocking** — For `runConvert()` and `convertToForgemanifest()`, the `inquirer` prompts could be tested by mocking the module (`vi.mock('inquirer')`). This would be needed for any orchestrator-level tests. Is this in scope, or should we limit to pure unit tests only?

4. **Snapshot testing** — For `printAdoptionStatus()` output, should we use Vitest snapshot tests (which auto-generate and detect regressions) or explicit string assertions (more brittle but more readable)?
