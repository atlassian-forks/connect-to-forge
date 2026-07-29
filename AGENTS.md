# AGENTS.md — connect-to-forge

## Purpose

`connect-to-forge` is a CLI tool that helps Atlassian Connect app developers migrate their apps to the Atlassian Forge platform. It takes an existing Atlassian Connect descriptor (a JSON file hosted at a public URL) and converts it into a Forge `manifest.yml` file — specifically a **connect-on-forge** manifest, which lets the existing Connect backend continue to run while the app is registered and managed under Forge.

The tool is published to npm and can be used without cloning:

```bash
npx connect-to-forge@latest --type <jira|confluence> --url https://website.com/path/to/descriptor.json
```

Or run locally after cloning:

```bash
yarn install
yarn start --type <jira|confluence> --url https://website.com/path/to/descriptor.json
```

---

## Repository Structure

```
connect-to-forge/
├── src/
│   └── index.ts                          # Entire CLI source (single file)
├── connect_app_confluence_test-descriptor.json  # Sample Confluence Connect descriptor for testing
├── ecosystem-app-host_connect-jira_44.json      # Full JSON schema of all connect-jira Forge module types
├── ecosystem-app-host_connect-jira_44.yaml      # Same schema, YAML format
├── my-reminders.json                     # Sample real-world Jira Connect descriptor for testing
├── llm-prompt.txt                        # The original LLM prompt used to bootstrap this tool
├── package.json                          # npm package config (v1.0.24)
├── tsconfig.json                         # TypeScript config (target: ES2016, module: CommonJS)
├── webpack.config.js                     # Webpack bundler config (produces dist/connect-to-forge.js)
├── .npmrc                                # Points to npmjs.org registry
├── .nvmrc                                # Node 18
└── .gitignore                            # Ignores node_modules, dist, manifest.yml, *.orig
```

---

## Source Code: `src/index.ts`

This is the only source file. It is a self-contained Node.js CLI program written in TypeScript. All logic lives here.

### Imports & Dependencies

| Package | Role |
|---|---|
| `axios` | HTTP download of the Connect descriptor from a remote URL |
| `js-yaml` | Parse existing `manifest.yml`; serialize the output manifest to YAML |
| `commander` | CLI argument parsing (`--url`, `--type`, `--output`) |
| `inquirer` | Interactive prompts for user decisions during conversion |
| `deepmerge` | Deep-merges a freshly generated manifest with an existing `manifest.yml` |
| `ts-is-present` | `isPresent()` null/undefined guard utility |
| `fs` | Read existing manifest, write output manifest |

---

### TypeScript Interfaces

#### `ConnectDescriptor`
Models the Atlassian Connect descriptor JSON:
- `name`, `key`, `baseUrl`, `scopes[]`
- `lifecycle?` — map of lifecycle event name → path (e.g. `installed`, `uninstalled`, `dare-migration`)
- `modules` — arbitrary map of module type name → module definition(s)
- `translations?` — i18n paths
- `regionBaseUrls?` — data residency region overrides
- `cloudAppMigration?` — migration webhook path
- `enableLicensing?`, `editionsEnabled?`, `dataResidency?`

#### `ForgeManifest`
Models the output Forge `manifest.yml`:
- `app.id` — placeholder ARI (must be replaced after `forge register`)
- `app.connect.key` — copied from Connect descriptor's top-level `key`
- `app.connect.remote` — always `'connect'`
- `app.runtime.name` — always `'nodejs20.x'`
- `app.licensing?` — optional, populated from `enableLicensing` / `editionsEnabled`
- `remotes[]` — array of remote backends; always has one entry with key `'connect'` and the descriptor's `baseUrl`
- `modules?` — native Forge modules (used for permissions and unlicensed-access Confluence modules)
- `connectModules` — map of `<type>:<moduleType>` → module array; the primary output section
- `permissions.scopes[]` — converted Connect scopes

---

### Constants

#### `UNSUPPORTED_MODULES`
An empty `Set<string>` — a placeholder for Connect module types that cannot be migrated to Forge. Currently no modules are listed as unsupported, but warnings are emitted for any that appear here.

#### `CONFLUENCE_MODULES_WITH_UNLICENSED_ACCESS`
A map of Connect Confluence module type names to their native Forge equivalent (`forgeKey`) and the `unlicensedAccess` values to apply (`['unlicensed', 'anonymous']`). These modules are migrated into the top-level `modules:` section of the Forge manifest (rather than `connectModules`) so that Forge's native unlicensed/anonymous access features are preserved.

| Connect Module Type | Forge Key | unlicensedAccess |
|---|---|---|
| `staticContentMacro` | `macro` | `['unlicensed', 'anonymous']` |
| `dynamicContentMacro` | `macro` | `['unlicensed', 'anonymous']` |
| `spacePage` | `confluence:spacePage` | `['unlicensed', 'anonymous']` |
| `customContent` | `confluence:customContent` | `['unlicensed', 'anonymous']` |
| `contextMenu` | `confluence:contextMenu` | `['unlicensed', 'anonymous']` |
| `contentAction` | `confluence:contentAction` | `['unlicensed', 'anonymous']` |
| `contentBylineItem` | `confluence:contentBylineItem` | `['unlicensed', 'anonymous']` |
| `pageBanner` | `confluence:pageBanner` | `['unlicensed', 'anonymous']` |

---

### Functions

#### `downloadConnectDescriptor(url: string): Promise<ConnectDescriptor>`
Downloads the Connect descriptor JSON from the provided URL using `axios.get()`. Exits the process with an error message if the download fails.

#### `loadExistingManifest(outputFilename: string): ForgeManifest | null`
Tries to read and parse the output file (default: `manifest.yml`) as YAML. Returns the parsed manifest if found, or `null` if the file doesn't exist. Used to support merging into an existing Forge manifest rather than always generating from scratch.

#### `genDefaultManifest(connect: ConnectDescriptor): ForgeManifest`
Generates a minimal, valid skeleton Forge manifest from the Connect descriptor. Sets:
- A placeholder `app.id` (so `forge register` can be run)
- `app.connect.key` from the descriptor
- `app.connect.remote = 'connect'`
- `app.runtime.name = 'nodejs20.x'`
- A single `remotes` entry with `key: 'connect'` and the descriptor's `baseUrl`
- Empty `connectModules` and `permissions.scopes`

#### `askForMigrationPath(defaultMigrationPath, warnings): Promise<string>`
Interactive prompt (via `inquirer`) asking the user to provide a new path for the data-residency migration endpoint. JWT auth is not supported on migration endpoints, so the existing Connect path cannot be reused directly. If left blank, the default is used and a warning is added.

#### `convertToForgemanifest(manifest, connect, type): Promise<[ForgeManifest, string[]]>`
The core conversion function. Takes a skeleton manifest, the Connect descriptor, and the app type (`'jira'` or `'confluence'`). Returns the updated manifest and a list of warning strings. Steps performed:

1. **Lifecycle events** — If present, all lifecycle events (except `dare-migration`) are moved into `connectModules.<type>:lifecycle` with `key: 'lifecycle-events'`.

2. **Licensing** — `enableLicensing` and `editionsEnabled` are mapped to `app.licensing`.

3. **Jira permission modules** (Jira only) — `jiraGlobalPermissions` and `jiraProjectPermissions` are migrated to native Forge `modules["jira:globalPermission"]` and `modules["jira:projectPermission"]` respectively, with `name`/`description` flattened from `{ value: "..." }` to plain strings, and a `migratedFromConnect: true` flag added. These are then removed from the Connect modules map to prevent duplication.

4. **Module migration** — For each remaining module type:
   - **Confluence unlicensed-access modules** (if `type === 'confluence'` and the module type is in `CONFLUENCE_MODULES_WITH_UNLICENSED_ACCESS`): migrated to `manifest.modules[forgeKey]` with `unlicensedAccess` appended. Both `staticContentMacro` and `dynamicContentMacro` merge into the same `macro` key.
   - **All other modules**: placed in `connectModules["<type>:<moduleType>"]`. Non-array values are wrapped in an array.

5. **Translations** — If present, moved to `connectModules.<type>:translations` with `key: 'connect-translations'`.

6. **Cloud app migration webhook** — If `cloudAppMigration.migrationWebhookPath` is present, moved to `connectModules.<type>:cloudAppMigration` with `key: 'app-migration'`.

7. **Unsupported module check** — Emits warnings for any module types listed in `UNSUPPORTED_MODULES` (currently none).

8. **Webhook keys** — Any webhooks in `connectModules.<type>:webhooks` have auto-generated keys assigned: `webhook-1`, `webhook-2`, etc.

9. **Scope conversion** — Each Connect scope is lowercased, underscores replaced with dashes, and the suffix `':connect-<type>'` appended (e.g. `PROJECT_ADMIN` → `project-admin:connect-jira`). The `ACT_AS_USER` scope is implicitly dropped (no explicit code, but the scope normalisation would produce a non-standard value — the original LLM prompt specified it should be warned and dropped).

10. **Data residency / region base URLs** — If `regionBaseUrls` is present:
    - If a `dare-migration` lifecycle hook exists, the user is prompted for a new migration path and a `migration:dataResidency` module is created.
    - Otherwise, a warning is emitted that no migration hook was found.
    - The user is prompted (via `inquirer` checkbox) to select the egress operation types (`storage`, `compute`, `fetch`, `other`).
    - If `storage` is selected, the user is asked whether end-user data (EUD) is stored remotely (`inScopeEUD`).
    - The `remotes[0]` entry is updated with `baseUrl` as a region map (including `default`), `operations`, and optionally `storage.inScopeEUD`.

11. **Empty modules cleanup** — If `manifest.modules` is present but empty after all processing, it is deleted (to avoid `forge lint` complaints).

#### `main()`
The top-level async entry point:
1. Downloads the Connect descriptor via `downloadConnectDescriptor`.
2. Generates a default manifest and runs `convertToForgemanifest`.
3. Loads any existing output manifest via `loadExistingManifest`.
4. If an existing manifest is found:
   - If it already has an `app.connect` section, the user is prompted to **Override** or **Abort**.
   - If it has no `app.connect` section, the two manifests are deep-merged (existing wins for conflicts).
5. If warnings were generated, prints them, links to the Forge limitations docs, and asks the user whether to proceed.
6. Prompts whether the app uses the Connect system user, and if so prints a warning with a link to the account persistence guide.
7. Serialises the manifest to YAML and writes it to the output file (default: `manifest.yml`).
8. Prints a link to the next step in the migration guide.

---

### CLI Options

| Flag | Required | Default | Description |
|---|---|---|---|
| `-u, --url <url>` | **Yes** | — | Public URL of the Atlassian Connect descriptor JSON |
| `-t, --type <type>` | No | — | `jira` or `confluence` |
| `-o, --output <path>` | No | `manifest.yml` | Path where the output manifest is written |

---

## Build & Package

### Development
```bash
yarn install       # Install dependencies
yarn start         # Run via ts-node (requires --type and --url args)
yarn start-jira    # Shortcut: --type jira --url <next arg>
yarn start-conf    # Shortcut: --type confluence --url <next arg>
```

### Production Build
```bash
yarn build         # tsc → compiles to dist/ (CommonJS, ES2016 target)
yarn prepack       # webpack → bundles to dist/connect-to-forge.js (used for npm publish)
```

The webpack config:
- Targets Node.js
- Entry point: `src/index.ts`
- Output: `dist/connect-to-forge.js`
- Prepends `#!/usr/bin/env node` shebang via `BannerPlugin` so the file is directly executable
- Uses `ts-loader` to compile TypeScript

The `package.json` `bin` field maps the `connect-to-forge` command to `./dist/connect-to-forge.js`, so after installing from npm the CLI is available globally.

---

## Data Files

### `my-reminders.json`
A real-world Jira Connect descriptor for a "My Reminders" app. Useful as a test input. Contains:
- Lifecycle hooks (`installed`, `uninstalled`)
- `webPanels`, `generalPages`, `webhooks`, `jiraIssueGlances` modules
- Scopes: `read`, `write`
- `key: 'com.atlassian.myreminders'`

### `connect_app_confluence_test-descriptor.json`
A minimal synthetic Confluence Connect descriptor for testing. Contains:
- `staticContentMacro`, `dynamicContentMacro`, `spacePage`, `contentAction`, `generalPages` modules
- Scopes: `READ`, `WRITE`

### `ecosystem-app-host_connect-jira_44.json` / `.yaml`
The full schema definition for all `connect-jira:*` module types supported in the Forge ecosystem. Contains JSON Schema definitions for every Jira Connect module type (e.g. `connect-jira:webhooks`, `connect-jira:generalPages`, `connect-jira:jiraIssueGlances`, etc.). Used as a reference — not imported by the code.

### `llm-prompt.txt`
The original natural-language prompt given to an LLM to generate the first version of this tool. Serves as a useful specification document — it describes all the conversion rules the tool should implement. This is how the project was bootstrapped.

---

## Conversion Rules Summary

| Connect Concept | Forge Output Location | Notes |
|---|---|---|
| `key` | `app.connect.key` | Top-level app identifier |
| `baseUrl` | `remotes[0].baseUrl` | Becomes the remote backend URL |
| `lifecycle.*` (except dare-migration) | `connectModules.<type>:lifecycle[0]` | Bundled under single key `lifecycle-events` |
| `lifecycle.dare-migration` | `modules.migration:dataResidency[0]` | Requires interactive prompt for new path |
| `modules.<type>` (general) | `connectModules.<type>:<moduleType>` | Arrays preserved; singletons wrapped in array |
| Confluence unlicensed modules | `modules.<forgeKey>` | `unlicensedAccess: ['unlicensed', 'anonymous']` added |
| `modules.webhooks` | `connectModules.<type>:webhooks` | Auto-generated `key` (`webhook-1`, `webhook-2`, …) |
| `modules.jiraGlobalPermissions` | `modules["jira:globalPermission"]` | `name`/`description` flattened; `migratedFromConnect: true` added |
| `modules.jiraProjectPermissions` | `modules["jira:projectPermission"]` | Same as above |
| `scopes[]` | `permissions.scopes[]` | Lowercased, `_` → `-`, suffix `:connect-<type>` |
| `translations.paths` | `connectModules.<type>:translations` | Key `connect-translations` |
| `cloudAppMigration.migrationWebhookPath` | `connectModules.<type>:cloudAppMigration` | Key `app-migration` |
| `enableLicensing` | `app.licensing.enabled` | |
| `editionsEnabled` | `app.licensing.editionsEnabled` | |
| `regionBaseUrls` | `remotes[0].baseUrl` (region map) | Interactive; also prompts for egress operations and EUD storage |

---

## Key Design Decisions

1. **Single-file architecture** — The entire tool is in one `src/index.ts` file. This keeps the codebase simple and easy to bundle.

2. **Connect-on-Forge, not full migration** — The generated manifest is not a full Forge rewrite. The Connect backend continues to serve requests via the `remotes` + `connectModules` pattern. This is the "connect-on-forge" migration path.

3. **Merge support** — If a `manifest.yml` already exists (e.g. the developer has already run `forge create` or added native Forge modules), the tool deep-merges rather than overwriting, unless the existing file already has an `app.connect` section (in which case the user chooses Override or Abort).

4. **Interactive prompts for ambiguous cases** — Where conversion requires a human decision (data residency operations, migration path, app user usage), the tool uses `inquirer` to ask rather than guessing.

5. **Warning system** — Non-fatal issues (e.g. unsupported modules, missing migration hook) are collected and presented to the user at the end with a link to the official Forge limitations documentation. The user must confirm to proceed.

6. **Webpack bundling for distribution** — The npm-published artifact is a single self-contained JS file with a shebang, making `npx` usage seamless without requiring TypeScript at runtime.

---

## Next Steps After Running the Tool

After generating `manifest.yml`, the official migration guide advises:
1. Run `forge register` to get a real app ID (replace the placeholder ARI).
2. Run `forge deploy` to deploy the app to Forge.
3. If the app uses the Connect system user, request account persistence via the Atlassian support process.

See: https://developer.atlassian.com/platform/adopting-forge-from-connect/how-to-adopt/#part-3--register-and-deploy-your-app-to-forge
