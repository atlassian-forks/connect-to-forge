import fs from 'fs';
import axios from 'axios';
import yaml from 'js-yaml';
import inquirer from 'inquirer';
import { isPresent } from 'ts-is-present';
import merge from 'deepmerge';
import { ConnectDescriptor, ConnectPermission, ConnectWebhook, ConnectWebhookWithKey, NormalisedPermission, ForgeManifest } from './types';

const UNSUPPORTED_MODULES = new Set<string>([]);

// Map of Connect module types to their native Forge module key and unlicensedAccess values.
// These modules support unlicensed/anonymous access in Forge and should be migrated to
// native Forge modules (under `modules:`) rather than staying in `connectModules`.
// Reference: https://developer.atlassian.com/platform/forge/access-to-forge-apps-for-unlicensed-users/
const CONFLUENCE_MODULES_WITH_UNLICENSED_ACCESS: Record<string, { forgeKey: string; unlicensedAccess: string[] }> = {
  staticContentMacro:   { forgeKey: 'macro',                       unlicensedAccess: ['unlicensed', 'anonymous'] },
  dynamicContentMacro:  { forgeKey: 'macro',                       unlicensedAccess: ['unlicensed', 'anonymous'] },
  spacePage:            { forgeKey: 'confluence:spacePage',         unlicensedAccess: ['unlicensed', 'anonymous'] },
  customContent:        { forgeKey: 'confluence:customContent',     unlicensedAccess: ['unlicensed', 'anonymous'] },
  contextMenu:          { forgeKey: 'confluence:contextMenu',       unlicensedAccess: ['unlicensed', 'anonymous'] },
  contentAction:        { forgeKey: 'confluence:contentAction',     unlicensedAccess: ['unlicensed', 'anonymous'] },
  contentBylineItem:    { forgeKey: 'confluence:contentBylineItem', unlicensedAccess: ['unlicensed', 'anonymous'] },
  pageBanner:           { forgeKey: 'confluence:pageBanner',        unlicensedAccess: ['unlicensed', 'anonymous'] },
};

// Helper function to download Atlassian Connect descriptor
export async function downloadConnectDescriptor(url: string): Promise<ConnectDescriptor> {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error(`Error downloading Atlassian Connect descriptor at ${url}: ${error}`);
    process.exit(1);
  }
}

export type LoadManifestResult =
  | { found: true; manifest: ForgeManifest }
  | { found: false };

export function loadExistingManifest(outputFilename: string): LoadManifestResult {
  try {
    const result = yaml.load(fs.readFileSync(outputFilename).toString('utf8'));
    return { found: true, manifest: result as ForgeManifest };
  } catch (e) {
    return { found: false };
  }
}

export function genDefaultManifest(connect: ConnectDescriptor): ForgeManifest {
  return {
    app: {
      id: 'ari:cloud:ecosystem::app/invalid-run-forge-register', // A dummy id is required for the 'forge register' command to work.
      connect: {
        key: connect.key,
        remote: 'connect'
      },
      runtime: {
        name: 'nodejs20.x'
      }
    },
    remotes: [
      {
        key: 'connect',
        baseUrl: connect.baseUrl
      }
    ],
    connectModules: {},
    permissions: {
      scopes: []
    }
  };
}

// Refactoring 2: pure scope normalisation
export function normaliseConnectScope(scope: string, type: 'jira' | 'confluence'): string {
  return `${scope.toLowerCase().replace(/_/g, '-')}:connect-${type}`;
}

// Refactoring 3a: pure permission normalisation
export function normalisePermission(permission: ConnectPermission): NormalisedPermission {
  return {
    ...permission,
    name: typeof permission.name === 'object' ? permission.name.value : permission.name,
    description: typeof permission.description === 'object' ? permission.description?.value : permission.description,
    migratedFromConnect: true,
  };
}

// Refactoring 3b: pure webhook key assignment
export function assignWebhookKeys(webhooks: ConnectWebhook[]): ConnectWebhookWithKey[] {
  return webhooks.map((webhook, index) => ({
    ...webhook,
    key: `webhook-${index + 1}`,
  }));
}

async function askForMigrationPath(
  defaultMigrationPath: string,
  warnings: string[]
) {
  const { migrationPath } = await inquirer.prompt([
    {
      type: "input",
      name: "migrationPath",
      message:
        "JWT auth is not supported on migration endpoints. Enter the new migrations path (leave empty to use the default path same as Connect and update it later):",
    },
  ]);

  if (!migrationPath.trim()) {
    warnings.push(
      "Warning: You should specify a new migration path because JWT auth is not supported on migration endpoints."
    );
  }

  return migrationPath.trim() || defaultMigrationPath;
}

// Options passed in place of interactive prompts — for testability
export interface BuildForgeManifestOptions {
  migrationPath?: string;      // replaces the dare-migration inquirer prompt
  egressOperations?: string[]; // replaces the egress checkbox
  inScopeEUD?: boolean;        // replaces the inScopeEUD confirm
}

// Refactoring 1: pure manifest-building logic, fully testable without I/O
export function buildForgeManifest(
  manifest: ForgeManifest,
  connect: ConnectDescriptor,
  type: 'jira' | 'confluence',
  options: BuildForgeManifestOptions = {}
): { manifest: ForgeManifest; warnings: string[] } {
  const warnings: string[] = [];

  // Work on a deep copy so we don't mutate the caller's objects
  const m: ForgeManifest = JSON.parse(JSON.stringify(manifest));
  const c: ConnectDescriptor = JSON.parse(JSON.stringify(connect));

  // Add lifecycle events
  if (c.lifecycle) {
    const moduleName = `${type}:lifecycle`;
    m.connectModules![moduleName] = [
      {
        key: 'lifecycle-events',
        ...Object.fromEntries(
          Object.entries(c.lifecycle).filter(([key]) => key !== 'dare-migration')
        ),
      },
    ];
  }

  // Licensing
  if (c.enableLicensing !== undefined) {
    m.app.licensing = { enabled: c.enableLicensing };
  }
  if (c.editionsEnabled) {
    if (m.app.licensing === undefined) {
      m.app.licensing = { enabled: true };
    }
    m.app.licensing.editionsEnabled = true;
  }

  // Jira permission modules
  if (type === 'jira') {
    if (!m.modules) m.modules = {};

    if (c.modules.jiraGlobalPermissions && Array.isArray(c.modules.jiraGlobalPermissions)) {
      m.modules['jira:globalPermission'] = c.modules.jiraGlobalPermissions.map(normalisePermission);
      delete c.modules.jiraGlobalPermissions;
    }

    if (c.modules.jiraProjectPermissions && Array.isArray(c.modules.jiraProjectPermissions)) {
      m.modules['jira:projectPermission'] = c.modules.jiraProjectPermissions.map(normalisePermission);
      delete c.modules.jiraProjectPermissions;
    }
  }

  // Add all other modules
  if (c.modules) {
    if (!m.modules) m.modules = {};

    for (const [moduleType, moduleContent] of Object.entries(c.modules)) {
      if (isPresent(moduleContent)) {
        const moduleArray = Array.isArray(moduleContent) ? moduleContent : [moduleContent];

        if (type === 'confluence' && moduleType in CONFLUENCE_MODULES_WITH_UNLICENSED_ACCESS) {
          const { forgeKey, unlicensedAccess } = CONFLUENCE_MODULES_WITH_UNLICENSED_ACCESS[moduleType];
          const nativeModules = moduleArray.map((entry: any) => ({ ...entry, unlicensedAccess }));
          if (m.modules![forgeKey]) {
            m.modules![forgeKey] = [...m.modules![forgeKey], ...nativeModules];
          } else {
            m.modules![forgeKey] = nativeModules;
          }
        } else {
          m.connectModules![`${type}:${moduleType}`] = moduleArray;
        }
      }
    }
  }

  // Translations
  if (c.translations?.paths && Object.entries(c.translations.paths).length > 0) {
    m.connectModules![`${type}:translations`] = [
      { paths: c.translations.paths, key: 'connect-translations' },
    ];
  }

  // Cloud app migration webhook
  if (c.cloudAppMigration?.migrationWebhookPath) {
    m.connectModules![`${type}:cloudAppMigration`] = [
      { migrationWebhookPath: c.cloudAppMigration.migrationWebhookPath, key: 'app-migration' },
    ];
  }

  // Unsupported modules
  warnings.push(
    ...Object.keys(c.modules)
      .filter(mod => UNSUPPORTED_MODULES.has(mod))
      .map(mod => `${mod} is not currently supported in a Forge manifest.`)
  );

  // Webhook keys
  const webhooks = c.modules.webhooks;
  if (webhooks && Array.isArray(webhooks)) {
    m.connectModules![`${type}:webhooks`] = assignWebhookKeys(webhooks);
  }

  // Scopes
  if (isPresent(c.scopes) && c.scopes.length > 0) {
    m.permissions.scopes = c.scopes.map(scope => normaliseConnectScope(scope, type));
  }

  // Data residency
  if (isPresent(c.regionBaseUrls)) {
    if (c.lifecycle?.['dare-migration']) {
      const migrationPath = options.migrationPath ?? c.lifecycle['dare-migration'];
      if (!options.migrationPath) {
        warnings.push('Warning: You should specify a new migration path because JWT auth is not supported on migration endpoints.');
      }
      m.modules = {
        'migration:dataResidency': [
          {
            key: 'dare',
            remote: 'connect',
            path: migrationPath,
            maxMigrationDurationHours: c.dataResidency?.maxMigrationDurationHours,
          },
        ],
      };
    } else {
      warnings.push('Region base URLs are present but no lifecycle hook for dare-migration event is defined.');
    }

    const regionKeys = Object.keys(c.regionBaseUrls);
    if (regionKeys.length > 0) {
      const regionBaseUrls: Record<string, any> = { default: c.baseUrl };
      regionKeys.forEach(regionKey => {
        regionBaseUrls[regionKey] = c.regionBaseUrls![regionKey];
      });

      const egressOperations = options.egressOperations ?? [];
      if (egressOperations.includes('storage')) {
        m.remotes![0] = {
          key: 'connect',
          baseUrl: regionBaseUrls,
          operations: egressOperations,
          storage: { inScopeEUD: options.inScopeEUD ?? true },
        };
      } else {
        m.remotes![0] = {
          key: 'connect',
          baseUrl: regionBaseUrls,
          operations: egressOperations.length > 0 ? egressOperations : undefined,
        };
      }
    }
  }

  // `forge lint` will complain if it finds an empty `modules`
  if (m.modules && Object.keys(m.modules).length === 0) {
    delete m.modules;
  }

  return { manifest: m, warnings };
}

// Helper function to convert Atlassian Connect descriptor to Forge manifest
export async function convertToForgemanifest(
  manifest: ForgeManifest,
  connect: ConnectDescriptor,
  type: "jira" | "confluence"
): Promise<[ForgeManifest, string[]]> {
  console.log(`Conversion begun for '${connect.name}':`);
  console.log("");

  // Resolve the dare-migration path interactively if needed
  let migrationPath: string | undefined;
  if (isPresent(connect.regionBaseUrls) && connect.lifecycle?.['dare-migration']) {
    migrationPath = await askForMigrationPath(connect.lifecycle['dare-migration'], []);
  }

  // Resolve egress operations interactively if needed
  let egressOperations: string[] | undefined;
  let inScopeEUD: boolean | undefined;
  if (isPresent(connect.regionBaseUrls) && Object.keys(connect.regionBaseUrls).length > 0) {
    const answers = await inquirer.prompt<{ operations: string[] }>([
      {
        type: 'checkbox',
        name: 'operations',
        message: 'What is the purpose of the data being egressed? See https://developer.atlassian.com/platform/forge/manifest-reference/remotes/#properties for more information.',
        choices: ['storage', 'compute', 'fetch', 'other'],
      },
    ]);
    egressOperations = answers.operations;

    if (answers.operations.includes('storage')) {
      const { inScopeEUDAnswer } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'inScopeEUDAnswer',
          message: 'Does your app egress end-user data to store it on a remote location?',
          default: true,
        },
      ]);
      inScopeEUD = inScopeEUDAnswer;
    }
  }

  const { manifest: builtManifest, warnings } = buildForgeManifest(manifest, connect, type, {
    migrationPath,
    egressOperations,
    inScopeEUD,
  });

  // Log what was built
  if (builtManifest.connectModules) {
    const connectModuleCount = Object.keys(builtManifest.connectModules).length;
    if (connectModuleCount > 0) {
      console.log(` - Moved ${connectModuleCount} module type(s) into connectModules in the manifest`);
    }
  }

  console.log("");

  return [builtManifest, warnings];
}

type ExpectedAction = 'Override' | 'Abort';

export async function runConvert(opts: { url: string; type: string; output: string }): Promise<void> {
  const connectDescriptor = await downloadConnectDescriptor(opts.url);
  let [forgeManifest, warnings] = await convertToForgemanifest(genDefaultManifest(connectDescriptor), connectDescriptor, opts.type as 'jira' | 'confluence');

  const loadResult = loadExistingManifest(opts.output);
  if (loadResult.found) {
    console.log(`Existing ${opts.output} file detected, will merge your Connect Modules in.`);
    console.log('');
  } else {
    console.log(`No existing ${opts.output} file detected, will create one.`);
    console.log('');
  }

  if (loadResult.found) {
    const existingManifest = loadResult.manifest;
    if (isPresent(existingManifest?.app?.connect)) {
      const answers = await inquirer.prompt<{ action: ExpectedAction }>([
        {
          type: 'list',
          name: 'action',
          message: 'We have detected that you already have a app.connect section in your manifest.yml. How do you want your manifest.yml to be modified?',
          choices: ['Override', 'Abort'],
        }
      ]);

      if (answers.action === 'Abort') {
        console.error('Aborting as requested!');
        process.exit(0);
      } else if (answers.action === 'Override') {
        console.log('Overriding your existing manifest with a freshly generated one based on the Connect Descriptor.');
      }

      console.log('');
    } else {
      forgeManifest = merge(forgeManifest, existingManifest);
    }
  }

  if (warnings.length > 0) {
    console.warn('Warnings detected:');
    warnings.forEach(warning => console.warn(`- ${warning}`));
    console.warn('');
    console.warn(`For more information about these limitations: https://developer.atlassian.com/platform/adopting-forge-from-connect/limitations-and-differences/#incompatibilities`);
    console.warn('');

    const { proceed } = await inquirer.prompt([
      {
        name: 'proceed',
        type: 'confirm',
        message: 'Do you wish to proceed with manifest generation despite the warnings?',
        default: false
      }
    ]);

    if (!proceed) {
      process.exit(0);
    }
  }

  const { appUser } = await inquirer.prompt([
    {
      name: 'appUser',
      type: 'confirm',
      message: 'Does this app use the Connect system user for anything (storing data against the app user, defining configuration of modules such as macros and dashboard items, expecting permissions to be granted to the user)?',
      default: false
    }
  ]);

  if (appUser) {
    console.warn('Before deploying your Forge app to production, please request your Connect user to be persisted. See https://developer.atlassian.com/platform/adopting-forge-from-connect/persist-app-accounts/ for instructions');
    console.warn('');
  }

  const manifestYaml = yaml.dump(forgeManifest);
  fs.writeFileSync(opts.output, manifestYaml);
  console.log(`Forge manifest generated and saved to ${opts.output}`);
  console.log('');
  console.log('To continue your journey by registering and deploying this app, please go to:');
  console.log('https://developer.atlassian.com/platform/adopting-forge-from-connect/how-to-adopt/#part-3--register-and-deploy-your-app-to-forge');
}
