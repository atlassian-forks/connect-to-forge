# Proposal: `connect-to-forge adoption-status` — Forge Adoption Status Reporter

## Background & Motivation

A developer from the community posted in the Atlassian partner Slack ([#connect-on-forge](https://atlassian.slack.com/archives/C09EZ9NU77W/p1784961092756839)) asking how they could verify that their app had truly completed its migration to Forge — i.e. that no Atlassian Connect modules, scopes, or references remained in their Forge manifest. They had migrated their app ("Rich Filters") and `forge deploy`ed what they believed was a purely-Forge manifest, but there was no tooling to confirm this programmatically.

This is a real, recurring pain point in the Connect-to-Forge migration journey:

- Developers must visually inspect their `manifest.yml` to look for leftover `connectModules` and Connect-style scopes — error-prone and tedious.
- There is no Atlassian Marketplace flag or API that gives a clear signal that an app is purely native Forge.
- `forge lint` validates schema correctness, but does not check for Connect remnants.

**The proposal** is to add an `adoption-status` subcommand to `connect-to-forge` that reads a manifest file and reports the app's current adoption status — how far along the migration it is, what Connect remnants remain, and what to do next.

---

## What Does "Fully Adopted" Mean?

A fully adopted Forge manifest (one with no Connect remnants) must have:
- No `connectModules` key (or an empty object)
- `app.connect.key` present and retained (this is permanent — it ties the app to its Connect identity)
- No other fields in `app.connect` beyond `key` (e.g. `remote`, `authentication` must be removed)
- No scopes with the `:connect-jira` or `:connect-confluence` suffix

---

## Proposed CLI Interface

```bash
# Report adoption status using manifest in the current directory (default: manifest.yml)
connect-to-forge adoption-status

# Check a specific manifest file
connect-to-forge adoption-status --manifest path/to/manifest.yml

# Exit with a non-zero code if any Connect remnants are found (useful in CI pipelines)
connect-to-forge adoption-status --strict

# Output results as JSON (for tooling integration)
connect-to-forge adoption-status --json
```

### New CLI Options for `adoption-status`

| Flag | Default | Description |
|---|---|---|
| `-m, --manifest <path>` | `manifest.yml` | Path to the Forge manifest file to check |
| `-s, --strict` | `false` | Exit with code `1` if any Connect remnants are found (CI-friendly) |
| `--json` | `false` | Output results as a JSON object instead of human-readable text |

---

## Detection Rules

The `adoption-status` command inspects the parsed YAML manifest and applies the following rules. Each rule has a **severity** (Error or Warning) and a **remediation hint**.

### Errors (definitive Connect remnants)

| Rule ID | What is checked | Remediation hint |
|---|---|---|
| `E001` | `connectModules` key exists and is non-empty | Migrate all modules under `connectModules` to native Forge `modules:` equivalents (see per-module guidance below) |
| `E002` | `app.connect` contains fields other than `key` (e.g. `remote`, `authentication`) | Remove all `app.connect` fields except `key`; they are Connect-on-Forge artefacts |
| `E003` | `app.connect.key` is absent (no `app.connect` section, or `app.connect` exists without a `key`) | `app.connect.key` must be retained indefinitely — it ties the Forge app to its Connect identity and is required for APIs such as the clientKey migration endpoint |
| `E004` | Any scope in `permissions.scopes` ends with `:connect-jira` or `:connect-confluence` | Replace with the equivalent native Forge scope (e.g. `read:jira-work` instead of `read:connect-jira`) |

#### E001 — Per-module remediation: `<type>:lifecycle`

If a `jira:lifecycle` or `confluence:lifecycle` module is present in `connectModules`, the app is still relying on the Connect lifecycle webhook to receive the `clientKey` at install time. This is **Option 1** from the [Forge clientKey migration guide](https://developer.atlassian.com/platform/adopting-forge-from-connect/migrate-connect-clientkey/) and means the migration is not yet complete.

**Recommended: migrate to Option 2** — use a native Forge trigger instead:

1. **Add a Forge trigger** on the `avi:forge:installed:app` event in `manifest.yml` (under `modules:`). This fires when the app is installed without needing any Connect lifecycle hooks.
2. **In the trigger handler**, call the reserved app properties API endpoint to retrieve the `clientKey`:
   - Jira: `GET /rest/atlassian-connect/1/addons/{app.connect.key}/properties/connect_client_key_019cdff3-8bfb-71fe-9628-875b700aebb8`
   - Confluence: `GET /wiki/rest/atlassian-connect/1/addons/{app.connect.key}/properties/connect_client_key_019cdff3-8bfb-71fe-9628-875b700aebb8`
3. **Remove the `<type>:lifecycle` entry** from `connectModules` once the trigger is in place.

This approach requires `app.connect.key` to remain set in the manifest (so the app properties API can be called), but the lifecycle module itself is no longer needed. **`app.connect.key` should be retained indefinitely** — it ties the Forge app to its Connect identity and must never be removed.

> **Note:** The `clientKey` migration API is a **one-time migration activity** and will not be available after Connect reaches End of Support. See the [full guide](https://developer.atlassian.com/platform/adopting-forge-from-connect/migrate-connect-clientkey/) for details.

### Warnings (possible Connect remnants or migration artifacts)

| Rule ID | What is checked | Why it's a warning |
|---|---|---|
| `W001` | `connectModules` key is present but empty `{}` | Harmless but should be cleaned up; `forge lint` may also flag this |
| `W002` | `app.id` matches the placeholder `ari:cloud:ecosystem::app/invalid-run-forge-register` | `forge register` has not been run; the app is not properly registered |
| `W003` | Any module entry references a URL pattern like `{issue.key}`, `{page.id}`, etc. | These are Connect-style context parameter tokens — verify they are handled by Forge |

---

## Output Format

### Human-readable (default)

When Connect remnants are present:

```
connect-to-forge adoption-status --manifest manifest.yml

Checking adoption status of manifest.yml...

✗ [E001] connectModules is present and non-empty (3 module type(s) found):
          - jira:webPanels (1 module)
          - jira:generalPages (2 modules)
          - jira:webhooks (2 modules)
          → Migrate these to native Forge modules: or remove them if no longer needed.

✗ [E002] app.connect contains fields beyond 'key': remote
          → Remove all app.connect fields except key; they are Connect-on-Forge artefacts.

✗ [E004] 2 Connect-style scope(s) found in permissions.scopes:
          - read:connect-jira  → use read:jira-work instead
          - write:connect-jira → use write:jira-work instead

⚠ [W002] App ID is the placeholder value — run `forge register` to get a real app ID.

Adoption status: your app still has Connect modules and scopes in its manifest.
It is running on Forge infrastructure but its behaviour is still being served
by the Connect backend. Continue migrating modules to native Forge equivalents
to complete the adoption.

3 error(s), 1 warning(s)

For help migrating: https://developer.atlassian.com/platform/adopting-forge-from-connect/how-to-adopt/
```

When the manifest is fully adopted:

```
connect-to-forge adoption-status --manifest manifest.yml

Checking adoption status of manifest.yml...

✓ No Connect modules found in connectModules
✓ app.connect.key is present
✓ No extra fields in app.connect beyond key
✓ No Connect-style scopes in permissions.scopes

Adoption status: your app is fully adopted on Forge. There are no remaining
Atlassian Connect modules or scopes in your manifest. Your app is running as
a purely native Forge app.
```

When some modules are migrated but others remain (partial adoption):

```
connect-to-forge adoption-status --manifest manifest.yml

Checking adoption status of manifest.yml...

✗ [E001] connectModules is present and non-empty (1 module type found):
          - jira:webhooks (2 modules)
          → Migrate these to native Forge modules: or remove them if no longer needed.

✓ app.connect.key is present
✓ No extra fields in app.connect beyond key
✓ No Connect-style scopes in permissions.scopes

Adoption status: your app is partially adopted on Forge. Most of your modules
have been migrated to native Forge equivalents, but some Connect modules remain.
Resolve the errors above to complete your adoption.

1 error(s), 0 warning(s)
```

### JSON output (`--json`)

```json
{
  "fullyAdopted": false,
  "summary": "Your app still has Connect modules and scopes in its manifest. It is running on Forge infrastructure but its behaviour is still being served by the Connect backend.",
  "errors": [
    {
      "id": "E001",
      "message": "connectModules is present and non-empty",
      "detail": { "moduleTypes": ["jira:webPanels", "jira:generalPages", "jira:webhooks"] },
      "remediation": "Migrate these to native Forge modules: or remove them if no longer needed."
    },
    {
      "id": "E002",
      "message": "app.connect contains fields beyond 'key'",
      "detail": { "extraFields": ["remote"] },
      "remediation": "Remove all app.connect fields except key."
    }
  ],
  "warnings": [
    {
      "id": "W002",
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

const adoptionStatusCmd = program.command('adoption-status')
  .description('Report the Forge adoption status of a manifest — checks for remaining Connect modules, scopes, and artefacts')
  .option('-m, --manifest <path>', 'Path to the Forge manifest', 'manifest.yml')
  .option('-s, --strict', 'Exit with code 1 if any Connect remnants found', false)
  .option('--json', 'Output results as JSON', false)
  .action(runAdoptionStatus);

program.parse(process.argv);
```

**Backwards compatibility note:** The current default behaviour (no subcommand, flat options) would need to be preserved or a deprecation notice added. One approach is to keep the existing flat behaviour as the default command and add `adoption-status` alongside it.

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

interface AdoptionStatusResult {
  fullyAdopted: boolean;
  summary: string;
  errors: CheckIssue[];
  warnings: CheckIssue[];
}

function checkManifest(manifest: ForgeManifest): AdoptionStatusResult {
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

  // E003: app.connect.key absent — must be retained indefinitely
  if (!manifest.app?.connect?.key) {
    errors.push({ id: 'E003', severity: 'error', message: 'app.connect.key is absent', remediation: 'Add app.connect.key with the original Connect app key — it must be retained indefinitely.' });
  }

  // E002: app.connect contains fields other than 'key'
  if (manifest.app?.connect) {
    const extraFields = Object.keys(manifest.app.connect).filter(k => k !== 'key');
    if (extraFields.length > 0) {
      errors.push({ id: 'E002', severity: 'error', message: 'app.connect contains Connect-on-Forge fields', detail: { extraFields }, remediation: 'Remove all app.connect fields except key.' });
    }
  }

  // E004: Connect-style scopes
  const connectScopes = manifest.permissions?.scopes?.filter(
    s => s.endsWith(':connect-jira') || s.endsWith(':connect-confluence')
  ) ?? [];
  if (connectScopes.length > 0) {
    errors.push({ id: 'E004', severity: 'error', message: '...', detail: { scopes: connectScopes }, remediation: '...' });
  }

  // W002: placeholder app ID
  // W003: Connect-style URL tokens

  const fullyAdopted = errors.length === 0;
  const summary = fullyAdopted
    ? 'Your app is fully adopted on Forge. There are no remaining Atlassian Connect modules or scopes in your manifest.'
    : errors.some(e => e.id === 'E001')
      ? 'Your app still has Connect modules in its manifest. It is running on Forge infrastructure but its behaviour is still being served by the Connect backend.'
      : 'Your app has Connect artefacts remaining in its manifest. Resolve the errors above to complete your adoption.';

  return { fullyAdopted, summary, errors, warnings };
}
```

### 3. Add `runAdoptionStatus()` action

```typescript
async function runAdoptionStatus(opts: { manifest: string; strict: boolean; json: boolean }) {
  const raw = fs.readFileSync(opts.manifest, 'utf8');
  const manifest = yaml.load(raw) as ForgeManifest;

  const result = checkManifest(manifest);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printAdoptionStatus(result);
  }

  if (opts.strict && !result.fullyAdopted) {
    process.exit(1);
  }
}
```

### 4. File structure changes

```
connect-to-forge/src/
├── index.ts              # Entry point; wires up Commander subcommands
├── convert.ts            # Extracted conversion logic (current index.ts content)
├── adoption-status.ts    # New: checkManifest(), runAdoptionStatus(), printAdoptionStatus()
└── types.ts              # Shared: ConnectDescriptor, ForgeManifest, AdoptionStatusResult interfaces
```

This split is recommended to keep files manageable, but the implementation could also stay in a single file to match the current architecture.

---

## Testing Strategy

### Unit tests for `checkManifest()`

The function is pure (no side effects, no I/O) so it is straightforward to unit test with Jest or Vitest:

```typescript
describe('checkManifest', () => {
  it('reports fully adopted for a clean native Forge manifest', () => {
    const manifest = { app: { id: 'ari:...', connect: { key: 'com.example.app' }, runtime: { name: 'nodejs20.x' } }, permissions: { scopes: [] } };
    expect(checkManifest(manifest as any).fullyAdopted).toBe(true);
  });

  it('detects non-empty connectModules as E001', () => {
    const manifest = { connectModules: { 'jira:webhooks': [{ key: 'w1' }] }, ... };
    const result = checkManifest(manifest as any);
    expect(result.errors.some(e => e.id === 'E001')).toBe(true);
  });

  it('detects missing app.connect.key as E007', () => {
    const manifest = { app: { id: 'ari:...', runtime: { name: 'nodejs20.x' } }, permissions: { scopes: [] } };
    const result = checkManifest(manifest as any);
    expect(result.errors.some(e => e.id === 'E007')).toBe(true);
  });

  // ... etc.
});
```

### Integration test fixtures

Use the existing test descriptors in the repo as end-to-end fixtures:
- Run `convert` on `my-reminders.json` → produces a connect-on-forge `manifest.yml` → `adoption-status` should report not fully adopted with specific errors.
- A hand-crafted `manifest.yml` with no Connect remnants → `adoption-status` should report fully adopted.

---

## CI / CD Use Case

The `--strict` and `--json` flags are designed for use in CI pipelines. A team could add a step to their deployment pipeline:

```yaml
# Example: GitHub Actions / Bitbucket Pipelines step
- name: Verify Forge adoption is complete
  run: npx connect-to-forge@latest adoption-status --strict --manifest manifest.yml
```

This would cause the pipeline to fail if the manifest still contains any Connect remnants, giving teams a concrete automated gate before they declare their migration complete.

---

## Scope & Effort Estimate

| Task | Effort |
|---|---|
| Refactor `program` to use Commander subcommands | Small (1–2 hours) |
| Extract types to `types.ts` | Small (30 min) |
| Implement `checkManifest()` with all rules | Medium (2–3 hours) |
| Implement `runAdoptionStatus()` with human + JSON output | Small (1–2 hours) |
| Write unit tests | Medium (2–3 hours) |
| Update README and AGENTS.md | Small (1 hour) |
| **Total** | **~8–12 hours** |

---

## Open Questions

1. **Backwards compatibility** — Should the current default (`connect-to-forge --url ...`) continue to work without the `convert` subcommand? Commander supports a "default command" pattern that would preserve this.

2. **Scope mapping hints** — For E004 (Connect-style scopes), should we provide a lookup table mapping each `:connect-jira` scope to the recommended native Forge scope? This would make the remediation output more actionable but requires maintaining a mapping table.

3. **E002/E006 consolidation** — E006 already covers the case where `app.connect.remote` is present (it is a field other than `key`). The original E002 was redundant and has been removed in favour of E006. This is worth confirming during implementation.

4. **Marketplace integration** — The original Slack question also asked whether Atlassian Marketplace has an API or flag to verify fully-adopted status. If such an API exists or is added in future, the `adoption-status` command could optionally query it to cross-reference the local manifest against the deployed version.

---

## References

- [Slack discussion that prompted this proposal](https://atlassian.slack.com/archives/C09EZ9NU77W/p1784961092756839)
- [Forge manifest reference](https://developer.atlassian.com/platform/forge/manifest-reference/)
- [Adopting Forge from Connect — how-to guide](https://developer.atlassian.com/platform/adopting-forge-from-connect/how-to-adopt/)
- [Forge limitations vs Connect](https://developer.atlassian.com/platform/adopting-forge-from-connect/limitations-and-differences/)
- [Forge unlicensed access](https://developer.atlassian.com/platform/forge/access-to-forge-apps-for-unlicensed-users/)
- [Migrate Connect clientKey in Forge (Option 2)](https://developer.atlassian.com/platform/adopting-forge-from-connect/migrate-connect-clientkey/)
