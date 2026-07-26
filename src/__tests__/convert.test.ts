import {
  genDefaultManifest,
  normaliseConnectScope,
  normalisePermission,
  assignWebhookKeys,
  buildForgeManifest,
} from '../convert';
import { minimalConnectDescriptor, makeDefaultManifest } from './manifest-fixtures';
import { ConnectDescriptor } from '../types';

// ─── genDefaultManifest() ─────────────────────────────────────────────────

describe('genDefaultManifest()', () => {
  const descriptor: ConnectDescriptor = {
    ...minimalConnectDescriptor,
    key: 'com.example.app',
    baseUrl: 'https://example.com',
  };
  const manifest = genDefaultManifest(descriptor);

  it('sets app.connect.key from descriptor', () => {
    expect(manifest.app.connect?.key).toBe('com.example.app');
  });

  it('sets app.connect.remote to connect', () => {
    expect(manifest.app.connect?.remote).toBe('connect');
  });

  it('sets remotes[0].baseUrl from descriptor', () => {
    expect(manifest.remotes![0].baseUrl).toBe('https://example.com');
  });

  it('sets remotes[0].key to connect', () => {
    expect(manifest.remotes![0].key).toBe('connect');
  });

  it('sets placeholder app ID', () => {
    expect(manifest.app.id).toBe('ari:cloud:ecosystem::app/invalid-run-forge-register');
  });

  it('sets runtime to nodejs20.x', () => {
    expect(manifest.app.runtime.name).toBe('nodejs20.x');
  });

  it('returns empty connectModules', () => {
    expect(manifest.connectModules).toEqual({});
  });

  it('returns empty permissions.scopes', () => {
    expect(manifest.permissions.scopes).toEqual([]);
  });
});

// ─── normaliseConnectScope() ──────────────────────────────────────────────

describe('normaliseConnectScope()', () => {
  it('lowercases the scope', () => {
    expect(normaliseConnectScope('READ', 'jira')).toBe('read:connect-jira');
  });

  it('replaces underscores with dashes', () => {
    expect(normaliseConnectScope('PROJECT_ADMIN', 'jira')).toBe('project-admin:connect-jira');
  });

  it('appends the correct type suffix for jira', () => {
    expect(normaliseConnectScope('write', 'jira')).toBe('write:connect-jira');
  });

  it('appends the correct type suffix for confluence', () => {
    expect(normaliseConnectScope('read', 'confluence')).toBe('read:connect-confluence');
  });

  it('handles already-lowercase scope', () => {
    expect(normaliseConnectScope('write', 'jira')).toBe('write:connect-jira');
  });
});

// ─── normalisePermission() ────────────────────────────────────────────────

describe('normalisePermission()', () => {
  it('flattens name when it is an object', () => {
    const result = normalisePermission({ key: 'p', name: { value: 'My Perm' } });
    expect(result.name).toBe('My Perm');
  });

  it('leaves name unchanged when it is already a string', () => {
    const result = normalisePermission({ key: 'p', name: 'My Perm' });
    expect(result.name).toBe('My Perm');
  });

  it('flattens description when it is an object', () => {
    const result = normalisePermission({ key: 'p', name: 'p', description: { value: 'A description' } });
    expect(result.description).toBe('A description');
  });

  it('leaves description unchanged when it is already a string', () => {
    const result = normalisePermission({ key: 'p', name: 'p', description: 'A description' });
    expect(result.description).toBe('A description');
  });

  it('adds migratedFromConnect: true to every permission', () => {
    const result = normalisePermission({ key: 'p', name: 'p' });
    expect(result.migratedFromConnect).toBe(true);
  });

  it('preserves other fields', () => {
    const result = normalisePermission({ key: 'p', name: 'p', anonymous: true });
    expect(result.anonymous).toBe(true);
  });
});

// ─── assignWebhookKeys() ──────────────────────────────────────────────────

describe('assignWebhookKeys()', () => {
  it('assigns sequential keys starting at webhook-1', () => {
    const result = assignWebhookKeys([
      { event: 'jira:issue_created', url: '/hook1' },
      { event: 'jira:issue_updated', url: '/hook2' },
      { event: 'jira:issue_deleted', url: '/hook3' },
    ]);
    expect(result[0].key).toBe('webhook-1');
    expect(result[1].key).toBe('webhook-2');
    expect(result[2].key).toBe('webhook-3');
  });

  it('preserves the event and url fields', () => {
    const result = assignWebhookKeys([{ event: 'jira:issue_created', url: '/hook' }]);
    expect(result[0].event).toBe('jira:issue_created');
    expect(result[0].url).toBe('/hook');
  });

  it('handles a single webhook', () => {
    const result = assignWebhookKeys([{ event: 'jira:issue_created', url: '/hook' }]);
    expect(result[0].key).toBe('webhook-1');
  });

  it('returns an empty array for empty input', () => {
    expect(assignWebhookKeys([])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [{ event: 'jira:issue_created', url: '/hook' }];
    assignWebhookKeys(input);
    expect((input[0] as any).key).toBeUndefined();
  });
});

// ─── buildForgeManifest() ─────────────────────────────────────────────────

describe('buildForgeManifest()', () => {
  // ── Lifecycle ──────────────────────────────────────────────────────────

  describe('lifecycle events', () => {
    it('moves lifecycle events into connectModules', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        lifecycle: { installed: '/installed', uninstalled: '/uninstalled' },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.connectModules!['jira:lifecycle']).toBeDefined();
      expect(manifest.connectModules!['jira:lifecycle'][0].key).toBe('lifecycle-events');
      expect(manifest.connectModules!['jira:lifecycle'][0].installed).toBe('/installed');
      expect(manifest.connectModules!['jira:lifecycle'][0].uninstalled).toBe('/uninstalled');
    });

    it('excludes dare-migration from the lifecycle module', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        lifecycle: { installed: '/installed', 'dare-migration': '/migrate' },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      const lifecycle = manifest.connectModules!['jira:lifecycle'][0];
      expect(lifecycle['dare-migration']).toBeUndefined();
    });
  });

  // ── Licensing ──────────────────────────────────────────────────────────

  describe('licensing', () => {
    it('maps enableLicensing: true', () => {
      const connect: ConnectDescriptor = { ...minimalConnectDescriptor, enableLicensing: true };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.app.licensing?.enabled).toBe(true);
    });

    it('maps enableLicensing: false', () => {
      const connect: ConnectDescriptor = { ...minimalConnectDescriptor, enableLicensing: false };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.app.licensing?.enabled).toBe(false);
    });

    it('maps editionsEnabled: true', () => {
      const connect: ConnectDescriptor = { ...minimalConnectDescriptor, editionsEnabled: true };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.app.licensing?.editionsEnabled).toBe(true);
    });
  });

  // ── Jira permission modules ────────────────────────────────────────────

  describe('Jira permission modules', () => {
    it('migrates jiraGlobalPermissions to native modules', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        modules: { jiraGlobalPermissions: [{ key: 'my-perm', name: 'My Perm' }] },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.modules!['jira:globalPermission']).toBeDefined();
      expect(manifest.connectModules!['jira:jiraGlobalPermissions']).toBeUndefined();
    });

    it('migrates jiraProjectPermissions to native modules', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        modules: { jiraProjectPermissions: [{ key: 'my-perm', name: 'My Perm' }] },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.modules!['jira:projectPermission']).toBeDefined();
      expect(manifest.connectModules!['jira:jiraProjectPermissions']).toBeUndefined();
    });
  });

  // ── Confluence native modules ──────────────────────────────────────────

  describe('Confluence native modules', () => {
    it('migrates staticContentMacro to native modules.macro with unlicensedAccess', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        modules: { staticContentMacro: [{ key: 'my-macro', name: 'My Macro', url: '/macro' }] },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'confluence');
      expect(manifest.modules!['macro']).toBeDefined();
      expect(manifest.modules!['macro'][0].unlicensedAccess).toEqual(['unlicensed', 'anonymous']);
    });

    it('migrates dynamicContentMacro to native modules.macro', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        modules: { dynamicContentMacro: [{ key: 'my-macro', name: 'My Macro', url: '/macro' }] },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'confluence');
      expect(manifest.modules!['macro']).toBeDefined();
    });

    it('merges staticContentMacro and dynamicContentMacro into the same macro array', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        modules: {
          staticContentMacro: [{ key: 'static-macro', name: 'Static', url: '/static' }],
          dynamicContentMacro: [{ key: 'dynamic-macro', name: 'Dynamic', url: '/dynamic' }],
        },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'confluence');
      expect(manifest.modules!['macro']).toHaveLength(2);
    });

    it('puts non-unlicensed Confluence modules into connectModules', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        modules: { generalPages: [{ key: 'my-page', name: 'My Page', url: '/page' }] },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'confluence');
      expect(manifest.connectModules!['confluence:generalPages']).toBeDefined();
    });
  });

  // ── General module handling ────────────────────────────────────────────

  describe('general module handling', () => {
    it('puts Jira modules into connectModules', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        modules: { webPanels: [{ key: 'my-panel', url: '/panel' }] },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.connectModules!['jira:webPanels']).toBeDefined();
    });

    it('wraps singleton modules in an array', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        modules: { someModule: { key: 'singleton' } },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(Array.isArray(manifest.connectModules!['jira:someModule'])).toBe(true);
      expect(manifest.connectModules!['jira:someModule']).toHaveLength(1);
    });
  });

  // ── Webhooks ───────────────────────────────────────────────────────────

  describe('webhooks', () => {
    it('assigns sequential keys to webhooks', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        modules: {
          webhooks: [
            { event: 'jira:issue_created', url: '/hook1' },
            { event: 'jira:issue_updated', url: '/hook2' },
          ],
        },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.connectModules!['jira:webhooks'][0].key).toBe('webhook-1');
      expect(manifest.connectModules!['jira:webhooks'][1].key).toBe('webhook-2');
    });
  });

  // ── Scopes ─────────────────────────────────────────────────────────────

  describe('scopes', () => {
    it('normalises scopes for Jira', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        scopes: ['READ', 'PROJECT_ADMIN'],
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.permissions.scopes).toContain('read:connect-jira');
      expect(manifest.permissions.scopes).toContain('project-admin:connect-jira');
    });

    it('normalises scopes for Confluence', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        scopes: ['WRITE'],
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'confluence');
      expect(manifest.permissions.scopes).toContain('write:connect-confluence');
    });
  });

  // ── Translations ───────────────────────────────────────────────────────

  describe('translations', () => {
    it('moves translations into connectModules', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        translations: { paths: { en: '/en', fr: '/fr' } },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.connectModules!['jira:translations']).toBeDefined();
      expect(manifest.connectModules!['jira:translations'][0].key).toBe('connect-translations');
    });
  });

  // ── cloudAppMigration ──────────────────────────────────────────────────

  describe('cloudAppMigration', () => {
    it('moves the migration webhook into connectModules', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        cloudAppMigration: { migrationWebhookPath: '/webhook' },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(manifest.connectModules!['jira:cloudAppMigration']).toBeDefined();
      expect(manifest.connectModules!['jira:cloudAppMigration'][0].key).toBe('app-migration');
    });
  });

  // ── Data residency ─────────────────────────────────────────────────────

  describe('data residency', () => {
    it('creates migration:dataResidency module when dare-migration lifecycle present', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        lifecycle: { 'dare-migration': '/migrate' },
        regionBaseUrls: { EU: 'https://eu.example.com' },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira', {
        migrationPath: '/new-migrate',
      });
      expect(manifest.modules!['migration:dataResidency']).toBeDefined();
      expect(manifest.modules!['migration:dataResidency'][0].path).toBe('/new-migrate');
    });

    it('emits a warning when regionBaseUrls present but no dare-migration lifecycle', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        regionBaseUrls: { EU: 'https://eu.example.com' },
      };
      const { warnings } = buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(warnings.some(w => w.includes('dare-migration'))).toBe(true);
    });

    it('sets region URLs in remotes[0].baseUrl', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        lifecycle: { 'dare-migration': '/migrate' },
        regionBaseUrls: { EU: 'https://eu.example.com' },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira', {
        migrationPath: '/new-migrate',
        egressOperations: [],
      });
      const baseUrl = manifest.remotes![0].baseUrl as Record<string, string>;
      expect(baseUrl['default']).toBe('https://example.com');
      expect(baseUrl['EU']).toBe('https://eu.example.com');
    });

    it('sets inScopeEUD when egressOperations includes storage', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        lifecycle: { 'dare-migration': '/migrate' },
        regionBaseUrls: { EU: 'https://eu.example.com' },
      };
      const { manifest } = buildForgeManifest(makeDefaultManifest(), connect, 'jira', {
        migrationPath: '/new-migrate',
        egressOperations: ['storage'],
        inScopeEUD: true,
      });
      expect(manifest.remotes![0].storage?.inScopeEUD).toBe(true);
    });
  });

  // ── Cleanup ────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('removes empty modules object from output', () => {
      const { manifest } = buildForgeManifest(makeDefaultManifest(), minimalConnectDescriptor, 'jira');
      expect(manifest.modules).toBeUndefined();
    });

    it('does not mutate the input manifest', () => {
      const input = makeDefaultManifest();
      const inputCopy = JSON.parse(JSON.stringify(input));
      buildForgeManifest(input, minimalConnectDescriptor, 'jira');
      expect(input).toEqual(inputCopy);
    });

    it('does not mutate the input descriptor', () => {
      const connect: ConnectDescriptor = {
        ...minimalConnectDescriptor,
        modules: { jiraGlobalPermissions: [{ key: 'p', name: 'P' }] },
      };
      const connectCopy = JSON.parse(JSON.stringify(connect));
      buildForgeManifest(makeDefaultManifest(), connect, 'jira');
      expect(connect).toEqual(connectCopy);
    });
  });
});
