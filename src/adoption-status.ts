import fs from 'fs';
import yaml from 'js-yaml';
import { ForgeManifest, AdoptionStatusResult, CheckIssue } from './types';

const PLACEHOLDER_APP_ID = 'ari:cloud:ecosystem::app/invalid-run-forge-register';

const SUMMARY_FULLY_ADOPTED = 'Your app is fully adopted on Forge. There are no remaining Atlassian Connect modules or scopes in your manifest.';
const SUMMARY_GONE_TOO_FAR = 'Your app appears to have gone too far — it looks fully migrated to Forge, but app.connect.key has been removed. This key must be kept permanently. Add it back to complete your adoption.';
const SUMMARY_UNSTARTED = 'Your app has been registered on Forge but no modules or scopes have been migrated yet. It is functionally still an Atlassian Connect app — all of its behaviour is served by the Connect backend.';
const SUMMARY_PARTIAL = 'Your app is partially adopted on Forge. Some modules have been migrated to native Forge equivalents, but Atlassian Connect modules remain. Resolve the errors above to complete your adoption.';

const REMEDIATION_E003_GONE_TOO_FAR = 'You have already fully migrated away from Atlassian Connect — but app.connect.key must be retained indefinitely as it ties the Forge app to its Connect identity. Add it back with your original Connect app key.';
const REMEDIATION_E003 = 'Add app.connect.key with the original Atlassian Connect app key — it must be retained indefinitely as it ties the Forge app to its Connect identity.';

export function checkManifest(manifest: ForgeManifest): AdoptionStatusResult {
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];

  // E001: connectModules non-empty
  if (manifest.connectModules && Object.keys(manifest.connectModules).length > 0) {
    const moduleTypes = Object.keys(manifest.connectModules);
    const detail = moduleTypes.map(t => {
      const entries = manifest.connectModules![t];
      const count = Array.isArray(entries) ? entries.length : 1;
      return `${t} (${count} module${count !== 1 ? 's' : ''})`;
    });
    errors.push({
      id: 'E001',
      severity: 'error',
      message: `connectModules is present and non-empty (${moduleTypes.length} module type${moduleTypes.length !== 1 ? 's' : ''} found)`,
      detail: { moduleTypes, formatted: detail },
      remediation: 'Migrate these to native Forge modules, or remove them if no longer needed. See: https://developer.atlassian.com/platform/adopting-forge-from-connect/how-to-adopt/',
    });
  }

  // W001: connectModules present but empty
  else if (manifest.connectModules && Object.keys(manifest.connectModules).length === 0) {
    warnings.push({
      id: 'W001',
      severity: 'warning',
      message: 'connectModules is present but empty',
      remediation: 'Remove the empty connectModules key — forge lint may flag this.',
    });
  }

  // E003: app.connect.key absent — must be retained indefinitely
  if (!manifest.app?.connect?.key) {
    errors.push({
      id: 'E003',
      severity: 'error',
      message: 'app.connect.key is absent',
      remediation: REMEDIATION_E003,
    });
  }

  // E002: app.connect contains fields other than 'key'
  if (manifest.app?.connect) {
    const extraFields = Object.keys(manifest.app.connect).filter(k => k !== 'key');
    if (extraFields.length > 0) {
      errors.push({
        id: 'E002',
        severity: 'error',
        message: `app.connect contains leftover Atlassian Connect fields: ${extraFields.join(', ')}`,
        detail: { extraFields },
        remediation: 'Remove all app.connect fields except key — these are leftover Atlassian Connect fields that are no longer needed.',
      });
    }
  }

  // E004: Connect-style scopes
  const connectScopes = (manifest.permissions?.scopes ?? []).filter(
    s => s.endsWith(':connect-jira') || s.endsWith(':connect-confluence')
  );
  if (connectScopes.length > 0) {
    errors.push({
      id: 'E004',
      severity: 'error',
      message: `${connectScopes.length} Atlassian Connect scope${connectScopes.length !== 1 ? 's' : ''} found in permissions.scopes`,
      detail: { scopes: connectScopes },
      remediation: 'Replace these with equivalent native Forge scopes (e.g. read:jira-work instead of read:connect-jira). See: https://developer.atlassian.com/platform/forge/manifest-reference/permissions/',
    });
  }

  // W002: placeholder app ID
  if (manifest.app?.id === PLACEHOLDER_APP_ID) {
    warnings.push({
      id: 'W002',
      severity: 'warning',
      message: 'app.id is the placeholder value — forge register has not been run',
      remediation: 'Run `forge register` to get a real app ID.',
    });
  }

  // W003: Connect-style context parameter tokens in module URLs
  const connectTokenPattern = /\{[a-zA-Z]+\.[a-zA-Z]+\}/;
  const allModules = [
    ...Object.values(manifest.connectModules ?? {}),
    ...Object.values(manifest.modules ?? {}),
  ].flat();
  const modulesWithTokens = allModules.filter((m: any) => {
    const str = JSON.stringify(m);
    return connectTokenPattern.test(str);
  });
  if (modulesWithTokens.length > 0) {
    warnings.push({
      id: 'W003',
      severity: 'warning',
      message: `${modulesWithTokens.length} module${modulesWithTokens.length !== 1 ? 's' : ''} contain Atlassian Connect context parameter tokens (e.g. {issue.key}, {page.id})`,
      remediation: 'Verify that these context parameters are handled correctly in your Forge app.',
    });
  }

  // Determine adoption state
  const fullyAdopted = errors.length === 0;
  const hasConnectModules = manifest.connectModules != null && Object.keys(manifest.connectModules).length > 0;
  const hasNativeModules = manifest.modules != null && Object.keys(manifest.modules).length > 0;
  const isUnstarted = hasConnectModules && !hasNativeModules;

  // If E003 is the only error, the user has gone too far — they removed the key
  // when they should have kept it, rather than having Connect work left to do.
  const onlyE003 = errors.length === 1 && errors[0].id === 'E003';
  if (onlyE003) {
    errors[0].remediation = REMEDIATION_E003_GONE_TOO_FAR;
  }

  let summary: string;
  if (fullyAdopted) {
    summary = SUMMARY_FULLY_ADOPTED;
  } else if (onlyE003) {
    summary = SUMMARY_GONE_TOO_FAR;
  } else if (isUnstarted) {
    summary = SUMMARY_UNSTARTED;
  } else {
    summary = SUMMARY_PARTIAL;
  }

  return { fullyAdopted, summary, errors, warnings };
}

function printIssues(issues: CheckIssue[], symbol: string, write: (line: string) => void): void {
  for (const issue of issues) {
    write(`${symbol} [${issue.id}] ${issue.message}`);
    if (issue.id === 'E001' && issue.detail?.formatted) {
      for (const line of issue.detail.formatted) {
        write(`          - ${line}`);
      }
    }
    if (issue.id === 'E004' && issue.detail?.scopes) {
      for (const scope of issue.detail.scopes) {
        write(`          - ${scope}`);
      }
    }
    write(`          → ${issue.remediation}`);
    write('');
  }
}

// Refactoring 5: injectable writer for testability — defaults to console.log
export function printAdoptionStatus(
  result: AdoptionStatusResult,
  write: (line: string) => void = console.log
): void {
  if (result.errors.length === 0) {
    write('✓ No Atlassian Connect modules found in connectModules');
    write('✓ app.connect.key is present');
    write('✓ No extra fields in app.connect beyond key');
    write('✓ No Atlassian Connect scopes in permissions.scopes');
    write('');
  } else {
    printIssues(result.errors, '✗', write);
  }
  printIssues(result.warnings, '⚠', write);

  write(`Adoption status: ${result.summary}`);
  write('');

  if (result.errors.length > 0 || result.warnings.length > 0) {
    write(`${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
    write('');
    write('For help migrating: https://developer.atlassian.com/platform/adopting-forge-from-connect/how-to-adopt/');
  }
}

export function parseManifest(raw: string, sourceName: string): ForgeManifest {
  let manifest: ForgeManifest;
  try {
    manifest = yaml.load(raw) as ForgeManifest;
  } catch (e) {
    throw new Error(`could not parse '${sourceName}' as YAML: ${e}`);
  }
  return manifest;
}

export async function runAdoptionStatus(opts: { manifest: string; strict: boolean; json: boolean }): Promise<void> {
  let raw: string;
  try {
    raw = fs.readFileSync(opts.manifest, 'utf8');
  } catch (e) {
    console.error(`Error: could not read manifest file '${opts.manifest}': ${e}`);
    process.exit(1);
  }

  let manifest: ForgeManifest;
  try {
    manifest = parseManifest(raw!, opts.manifest);
  } catch (e) {
    console.error(`Error: ${e}`);
    process.exit(1);
  }

  console.log(`Checking adoption status of ${opts.manifest}...`);
  console.log('');

  const result = checkManifest(manifest!);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printAdoptionStatus(result);
  }

  if (opts.strict && !result.fullyAdopted) {
    process.exit(1);
  }
}
