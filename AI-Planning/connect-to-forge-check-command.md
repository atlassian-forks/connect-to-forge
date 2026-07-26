# Proposal: `connect-to-forge check` — Forge Level 3 Manifest Validator

## Background & Motivation

A developer from the community posted in the Atlassian partner Slack ([#connect-on-forge](https://atlassian.slack.com/archives/C09EZ9NU77W/p1784961092756839)) asking how they could verify that their app had truly reached **Forge Level 3** — i.e. that no Atlassian Connect modules, scopes, or references remained in their Forge manifest. They had migrated their app ("Rich Filters") and `forge deploy`ed what they believed was a purely-Forge manifest, but there was no tooling to confirm this programmatically.

This is a real, recurring pain point in the Connect-to-Forge migration journey:

- Developers must visually inspect their `manifest.yml` to look for leftover `connectModules`, `remotes`, and Connect-style scopes — error-prone and tedious.
- There is no Atlassian Marketplace flag or API that gives a clear "this is Forge Level 3" signal.
- `forge lint` validates schema correctness, but does not check for Connect remnants.

**The proposal** is to add a `check` subcommand to `connect-to-forge` that reads a manifest file and reports whether it is free of all Atlassian Connect constructs, with clear, actionable output.

---

## What Is "Forge Level 3"?

The Forge migration levels (informally) are:

| Level | Description |
|---|---|
| **Level 1** | App registered in Forge but all modules still in `connectModules` |
| **Level 2** | Some modules migrated to native Forge `modules:`, some still in `connectModules` |
| **Level 3** | No `connectModules`, no Connect-style scopes, no `remotes` — purely native Forge |

A **Level 3 manifest** must have:
- No `connectModules` key (or an empty object)
- No `app.connect` section
- No entries in `remotes` (or no `remotes` key)
- No scopes with the `:connect-jira` or `:connect-confluence` suffix
- No `modules.migration:dataResidency` (used only during data-residency migration)

---

## Proposed CLI Interface

```bash
# Check a manifest in the current directory (default: manifest.yml)
connect-to-forge check

# Check a specific manifest file
connect-to-forge check --manifest path/to/manifest.yml

# Exit with a non-zero code if not Level 3 (useful in CI pipelines)
connect-to-forge check --strict

# Output results as JSON (for tooling integration)
connect-to-forge check --json
```

### New CLI Options for `check`

| Flag | Default | Description |
|---|---|---|
| `-m, --manifest <path>` | `manifest.yml` | Path to the Forge manifest file to check |
| `-s, --strict` | `false` | Exit with code `1` if any Connect remnants are found (CI-friendly) |
| `--json` | `false` | Output results as a JSON object instead of human-readable text |

---

## Detection Rules

The `check` command inspects the parsed YAML manifest and applies the following rules. Each rule has a **severity** (Error or Warning) and a **remediation hint**.

### Errors (definitive Connect remnants)

| Rule ID | What is checked | Remediation hint |
|---|---|---|
| `E001` | `connectModules` key exists and is non-empty | Migrate all modules under `connectModules` to native Forge `modules:` equivalents (see per-module guidance below) |
| `E002` | `app.connect` section is present | Remove `app.connect` (and `app.connect.key`, `app.connect.remote`) after full migration |
| `E003` | `remotes` array is non-empty | Remove the `remotes` section; native Forge functions handle backend calls directly |
| `E004` | Any scope in `permissions.scopes` ends with `:connect-jira` or `:connect-confluence` | Replace with the equivalent native Forge scope (e.g. `read:jira-work` instead of `read:connect-jira`) |
| `E005` | `modules["migration:dataResidency"]` is present | This module is only needed during data-residency migration; remove once complete |

#### E001 — Per-module remediation: `<type>:lifecycle`

If a `jira:lifecycle` or `confluence:lifecycle` module is present in `connectModules`, the app is still relying on the Connect lifecycle webhook to receive the `clientKey` at install time. This is **Option 1** from the [Forge clientKey migration guide](https://developer.atlassian.com/platform/adopting-forge-from-connect/migrate-connect-clientkey/) and is not compatible with Forge Level 3.

**Recommended: migrate to Option 2** — use a native Forge trigger instead:

1. **Add a Forge trigger** on the `avi:forge:installed:app` event in `manifest.yml` (under `modules:`). This fires when the app is installed without needing any Connect lifecycle hooks.
2. **In the trigger handler**, call the reserved app properties API endpoint to retrieve the `clientKey`:
   - Jira: `GET /rest/atlassian-connect/1/addons/{app.connect.key}/properties/connect_client_key_019cdff3-8bfb-71fe-9628-875b700aebb8`
   - Confluence: `GET /wiki/rest/atlassian-connect/1/addons/{app.connect.key}/properties/connect_client_key_019cdff3-8bfb-71fe-9628-875b700aebb8`
3. **Remove the `<type>:lifecycle` entry** from `connectModules` once the trigger is in place.

This approach requires `app.connect.key` to still be set in the manifest during the migration window (so the app properties API can be called), but the lifecycle module itself is no longer needed. Once all existing installations have been migrated and `clientKey`-keyed data has been re-keyed, `app.connect.key` can also be removed.

> **Note:** The `clientKey` migration API is a **one-time migration activity** and will not be available after Connect reaches End of Support. See the [full guide](https://developer.atlassian.com/platform/adopting-forge-from-connect/migrate-connect-clientkey/) for details.

### Warnings (possible Connect remnants or migration artifacts)

| Rule ID | What is checked | Why it's a warning |
|---|---|---|
| `W001` | `connectModules` key is present but empty `{}` | Harmless but should be cleaned up; `forge lint` may also flag this |
| `W002` | Any module entry has `migratedFromConnect: true` | Left by `connect-to-forge` as a migration marker; safe to remove once verified |
| `W003` | `app.id` matches the placeholder `ari:cloud:ecosystem::app/invalid-run-forge-register` | `forge register` has not been run; the app is not properly registered |
| `W004` | Any module entry references a URL pattern like `{issue.key}`, `{page.id}`, etc. | These are Connect-style context parameter tokens — verify they are handled by Forge |

---

## Output Format

### Human-readable (default)

```
connect-to-forge check --manifest manifest.yml

Checking manifest.yml for Atlassian Connect remnants...

✗ [E001] connectModules is present and non-empty (3 module type(s) found):
          - jira:webPanels (1 module)
          - jira:generalPages (2 modules)
          - jira:webhooks (2 modules)
          → Migrate these to native Forge modules: or remove them if no longer needed.

✗ [E002] app.connect section is present (key: com.example.myapp)
          → Remove app.connect after completing migration to native Forge modules.

✗ [E003] remotes array is non-empty (1 remote: connect → https://my-app.example.com)
          → Remove remotes: once your backend logic is in Forge functions.

✗ [E004] 2 Connect-style scope(s) found in permissions.scopes:
          - read:connect-jira  → use read:jira-work instead
          - write:connect-jira → use write:jira-work instead

⚠ [W003] App ID is the placeholder value — run `forge register` to get a real app ID.

Result: NOT Forge Level 3 ✗
         4 error(s), 1 warning(s)

For help migrating: https://developer.atlassian.com/platform/adopting-forge-from-connect/how-to-adopt/
```

When the manifest is clean:

```
connect-to-forge check --manifest manifest.yml

Checking manifest.yml for Atlassian Connect remnants...

✓ No Connect modules found in connectModules
✓ No app.connect section present
✓ No remotes defined
✓ No Connect-style scopes in permissions.scopes
✓ No migration:dataResidency module present

Result: Forge Level 3 ✓ — this manifest contains no Atlassian Connect remnants.
```

### JSON output (`--json`)

```json
{
  "forgeLevel3": false,
  "errors": [
    {
      "id": "E001",
      "message": "connectModules is present and non-empty",
      "detail": { "moduleTypes": ["jira:webPanels", "jira:generalPages", "jira:webhooks"] },
      "remediation": "Migrate these to native Forge modules: or remove them if no longer needed."
    },
    {
      "id": "E002",
      "message": "app.connect section is present",
      "detail": { "connectKey": "com.example.myapp" },
      "remediation": "Remove app.connect after completing migration to native Forge modules."
    }
  ],
  "warnings": [
    {
      "id": "W003",
      "message": "App ID is the placeholder value",
      "remediation": "Run `forge register` to get a real app ID."
    }
  ]
}
```

---

## Implementation Plan

### 1. Refactor CLI to use Commander subcommands

Currently `connect-to-forge` uses a flat `program` with top-level options. Commander supports subcommands natively. The refactor would look like:

```typescript
// Before (current):
program
  .requiredOption('-u, --url <url>', '...')
  .option('-t, --type <type>', '...')
  .option('-o, --output <path>', 'Output file path', 'manifest.yml')
  .parse(process.argv);

// After:
const convertCmd = program.command('convert')
  .description('Convert an Atlassian Connect descriptor to a Forge manifest')
  .requiredOption('-u, --url <url>', '...')
  .option('-t, --type <type>', '...')
  .option('-o, --output <path>', 'Output file path', 'manifest.yml')
  .action(main);

const checkCmd = program.command('check')
  .description('Check a Forge manifest for Atlassian Connect remnants')
  .option('-m, --manifest <path>', 'Path to the Forge manifest', 'manifest.yml')
  .option('-s, --strict', 'Exit with code 1 if any Connect remnants found', false)
  .option('--json', 'Output results as JSON', false)
  .action(runCheck);

program.parse(process.argv);
```

**Backwards compatibility note:** The current default behaviour (no subcommand, flat options) would need to be preserved or a deprecation notice added. One approach is to keep the existing flat behaviour as the default command and add `check` alongside it.

### 2. Add `checkManifest()` function

A new pure function that takes a parsed `ForgeManifest` object and returns a structured result:

```typescript
interface CheckIssue {
  id: string;           // e.g. 'E001'
  severity: 'error' | 'warning';
  message: string;
  detail?: Record<string, any>;
  remediation: string;
}

interface CheckResult {
  forgeLevel3: boolean;
  errors: CheckIssue[];
  warnings: CheckIssue[];
}

function checkManifest(manifest: ForgeManifest): CheckResult {
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];

  // E001: connectModules non-empty
  if (manifest.connectModules && Object.keys(manifest.connectModules).length > 0) {
    errors.push({ id: 'E001', severity: 'error', message: '...', detail: { moduleTypes: Object.keys(manifest.connectModules) }, remediation: '...' });
  }

  // W001: connectModules empty
  else if (manifest.connectModules && Object.keys(manifest.connectModules).length === 0) {
    warnings.push({ id: 'W001', severity: 'warning', message: '...', remediation: '...' });
  }

  // E002: app.connect present
  if (manifest.app?.connect) {
    errors.push({ id: 'E002', severity: 'error', message: '...', detail: { connectKey: manifest.app.connect.key }, remediation: '...' });
  }

  // E003: remotes non-empty
  if (manifest.remotes && manifest.remotes.length > 0) {
    errors.push({ id: 'E003', severity: 'error', message: '...', detail: { remotes: manifest.remotes.map(r => r.key) }, remediation: '...' });
  }

  // E004: Connect-style scopes
  const connectScopes = manifest.permissions?.scopes?.filter(
    s => s.endsWith(':connect-jira') || s.endsWith(':connect-confluence')
  ) ?? [];
  if (connectScopes.length > 0) {
    errors.push({ id: 'E004', severity: 'error', message: '...', detail: { scopes: connectScopes }, remediation: '...' });
  }

  // E005: migration:dataResidency
  if (manifest.modules?.['migration:dataResidency']) {
    errors.push({ id: 'E005', severity: 'error', message: '...', remediation: '...' });
  }

  // W002: migratedFromConnect markers
  // W003: placeholder app ID
  // W004: Connect-style URL tokens

  return {
    forgeLevel3: errors.length === 0,
    errors,
    warnings,
  };
}
```

### 3. Add `runCheck()` action

```typescript
async function runCheck(opts: { manifest: string; strict: boolean; json: boolean }) {
  const raw = fs.readFileSync(opts.manifest, 'utf8');
  const manifest = yaml.load(raw) as ForgeManifest;

  const result = checkManifest(manifest);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printCheckResult(result);
  }

  if (opts.strict && !result.forgeLevel3) {
    process.exit(1);
  }
}
```

### 4. File structure changes

```
connect-to-forge/src/
├── index.ts          # Entry point; wires up Commander subcommands
├── convert.ts        # Extracted conversion logic (current index.ts content)
├── check.ts          # New: checkManifest(), runCheck(), printCheckResult()
└── types.ts          # Shared: ConnectDescriptor, ForgeManifest, CheckResult interfaces
```

This split is recommended to keep files manageable, but the implementation could also stay in a single file to match the current architecture.

---

## Testing Strategy

### Unit tests for `checkManifest()`

The function is pure (no side effects, no I/O) so it is straightforward to unit test with Jest or Vitest:

```typescript
describe('checkManifest', () => {
  it('returns forgeLevel3: true for a clean native Forge manifest', () => {
    const manifest = { app: { id: 'ari:...', runtime: { name: 'nodejs20.x' } }, permissions: { scopes: [] } };
    expect(checkManifest(manifest as any).forgeLevel3).toBe(true);
  });

  it('detects non-empty connectModules as E001', () => {
    const manifest = { connectModules: { 'jira:webhooks': [{ key: 'w1' }] }, ... };
    const result = checkManifest(manifest as any);
    expect(result.errors.some(e => e.id === 'E001')).toBe(true);
  });

  // ... etc.
});
```

### Integration test fixtures

Use the existing test descriptors in the repo as end-to-end fixtures:
- Run `convert` on `my-reminders.json` → produces a connect-on-forge `manifest.yml` → `check` should report **not Level 3** with specific errors.
- A hand-crafted `manifest.yml` with no Connect remnants → `check` should report **Level 3**.

---

## CI / CD Use Case

The `--strict` and `--json` flags are designed for use in CI pipelines. A team could add a step to their deployment pipeline:

```yaml
# Example: GitHub Actions / Bitbucket Pipelines step
- name: Verify Forge Level 3
  run: npx connect-to-forge@latest check --strict --manifest manifest.yml
```

This would cause the pipeline to fail if the manifest still contains any Connect remnants, giving teams a concrete automated gate before they declare their migration complete.

---

## Scope & Effort Estimate

| Task | Effort |
|---|---|
| Refactor `program` to use Commander subcommands | Small (1–2 hours) |
| Extract types to `types.ts` | Small (30 min) |
| Implement `checkManifest()` with all rules | Medium (2–3 hours) |
| Implement `runCheck()` with human + JSON output | Small (1–2 hours) |
| Write unit tests | Medium (2–3 hours) |
| Update README and AGENTS.md | Small (1 hour) |
| **Total** | **~8–12 hours** |

---

## Open Questions

1. **Backwards compatibility** — Should the current default (`connect-to-forge --url ...`) continue to work without the `convert` subcommand? Commander supports a "default command" pattern that would preserve this.

2. **Scope mapping hints** — For E004 (Connect-style scopes), should we provide a lookup table mapping each `:connect-jira` scope to the recommended native Forge scope? This would make the remediation output more actionable but requires maintaining a mapping table.

3. **Future: `--level` flag** — We could extend the check to report a numeric Forge Level (1, 2, or 3) rather than just a pass/fail. This would require defining what Level 1 and Level 2 look like quantitatively (e.g. percentage of modules still in `connectModules`).

4. **Marketplace integration** — The original Slack question also asked whether Atlassian Marketplace has an API or flag to verify Level 3 status. If such an API exists or is added in future, the `check` command could optionally query it to cross-reference the local manifest against the deployed version.

---

## References

- [Slack discussion that prompted this proposal](https://atlassian.slack.com/archives/C09EZ9NU77W/p1784961092756839)
- [Forge manifest reference](https://developer.atlassian.com/platform/forge/manifest-reference/)
- [Adopting Forge from Connect — how-to guide](https://developer.atlassian.com/platform/adopting-forge-from-connect/how-to-adopt/)
- [Forge limitations vs Connect](https://developer.atlassian.com/platform/adopting-forge-from-connect/limitations-and-differences/)
- [Forge unlicensed access](https://developer.atlassian.com/platform/forge/access-to-forge-apps-for-unlicensed-users/)
- [Migrate Connect clientKey in Forge (Option 2)](https://developer.atlassian.com/platform/adopting-forge-from-connect/migrate-connect-clientkey/)
