## connect-to-forge

A set of tools to help Connect developers migrate their apps to Forge.

## Commands

### `convert` — Convert a Connect descriptor to a Forge manifest

Converts an Atlassian Connect descriptor to a Connect-on-Forge `manifest.yml`, giving you a starting point for your migration.

```bash
npx @atlassian/connect-to-forge@latest convert --type <jira|confluence> --url https://website.com/path/to/descriptor.json
```

If you want to check out this repository and run it locally:

```bash
yarn install
yarn start convert --type <jira|confluence> --url https://website.com/path/to/descriptor.json
```

Where `--type` is the Atlassian product the app targets and `--url` is a publicly accessible URL to your Connect descriptor JSON.

---

### `adoption-status` — Check your Forge adoption progress

Checks a Forge `manifest.yml` for remaining Atlassian Connect artefacts and reports your adoption status. Useful at any stage of migration to understand what still needs to be done — or to confirm you are fully adopted.

```bash
npx @atlassian/connect-to-forge@latest adoption-status --manifest path/to/manifest.yml
```

If you want to run it locally:

```bash
yarn start adoption-status --manifest path/to/manifest.yml
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `-m, --manifest <path>` | Path to the Forge manifest file to check | `manifest.yml` |
| `-s, --strict` | Exit with code 1 if any Connect remnants are found (useful in CI pipelines) | `false` |
| `--json` | Output results as JSON instead of human-readable text | `false` |

**What it checks:**

| ID | Severity | Description |
|----|----------|-------------|
| E001 | Error | `connectModules` is present and non-empty — modules have not been migrated yet |
| E002 | Error | `app.connect` contains leftover fields beyond `key` |
| E003 | Error | `app.connect.key` is absent — this key must be retained indefinitely |
| E004 | Error | Connect-style scopes (e.g. `read:connect-jira`) found in `permissions.scopes` |
| W001 | Warning | `connectModules` is present but empty |
| W002 | Warning | `app.id` is still the placeholder value — `forge register` has not been run |
| W003 | Warning | Module URLs contain Connect-style context parameter tokens (e.g. `{issue.key}`) |

**Example output (fully adopted):**

```
Checking adoption status of manifest.yml...

✓ No Atlassian Connect modules found in connectModules
✓ app.connect.key is present
✓ No extra fields in app.connect beyond key
✓ No Atlassian Connect scopes in permissions.scopes

Adoption status: Your app is fully adopted on Forge. There are no remaining Atlassian Connect modules or scopes in your manifest.
```