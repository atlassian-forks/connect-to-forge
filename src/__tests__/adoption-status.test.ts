import { checkManifest, parseManifest } from '../adoption-status';
import { ForgeManifest } from '../types';

// A minimal valid fully-adopted manifest — passes all checks
const VALID_MANIFEST: ForgeManifest = {
  app: {
    id: 'ari:cloud:ecosystem::app/some-real-app-id',
    connect: {
      key: 'my-connect-app-key',
    },
    runtime: { name: 'nodejs18.x' },
  },
  modules: {
    'jira:issuePanel': [{ key: 'my-panel', title: 'My Panel', resource: 'main' }],
  },
  permissions: {
    scopes: ['read:jira-work', 'write:jira-work'],
  },
};

function makeManifest(overrides: {
  app?: Partial<ForgeManifest['app']>;
  connectModules?: ForgeManifest['connectModules'];
  modules?: ForgeManifest['modules'];
  permissions?: ForgeManifest['permissions'];
}): ForgeManifest {
  return {
    ...VALID_MANIFEST,
    ...overrides,
    app: {
      ...VALID_MANIFEST.app,
      ...overrides.app,
    },
  };
}

// ─── E001: connectModules non-empty ────────────────────────────────────────

describe('E001: connectModules non-empty', () => {
  it('raises E001 when connectModules has entries', () => {
    const manifest = makeManifest({
      connectModules: { 'jira:issuePanel': [{ key: 'old-panel' }] },
    });
    const result = checkManifest(manifest);
    const e001 = result.errors.find(e => e.id === 'E001');
    expect(e001).toBeDefined();
    expect(e001?.severity).toBe('error');
    expect(e001?.detail?.moduleTypes).toContain('jira:issuePanel');
  });

  it('does not raise E001 when connectModules is absent', () => {
    const result = checkManifest(VALID_MANIFEST);
    expect(result.errors.find(e => e.id === 'E001')).toBeUndefined();
  });
});

// ─── W001: connectModules present but empty ────────────────────────────────

describe('W001: connectModules present but empty', () => {
  it('raises W001 when connectModules is an empty object', () => {
    const manifest = makeManifest({ connectModules: {} });
    const result = checkManifest(manifest);
    const w001 = result.warnings.find(w => w.id === 'W001');
    expect(w001).toBeDefined();
    expect(w001?.severity).toBe('warning');
  });

  it('does not raise W001 when connectModules is absent', () => {
    const result = checkManifest(VALID_MANIFEST);
    expect(result.warnings.find(w => w.id === 'W001')).toBeUndefined();
  });
});

// ─── E002: extra fields in app.connect ────────────────────────────────────

describe('E002: extra fields in app.connect', () => {
  it('raises E002 when app.connect has fields beyond key', () => {
    const manifest = makeManifest({
      app: { connect: { key: 'my-key', remote: 'old-remote', authentication: 'jwt' } },
    });
    const result = checkManifest(manifest);
    const e002 = result.errors.find(e => e.id === 'E002');
    expect(e002).toBeDefined();
    expect(e002?.detail?.extraFields).toContain('remote');
    expect(e002?.detail?.extraFields).toContain('authentication');
  });

  it('does not raise E002 when app.connect only has key', () => {
    const result = checkManifest(VALID_MANIFEST);
    expect(result.errors.find(e => e.id === 'E002')).toBeUndefined();
  });

  it('does not raise E002 when app.connect is absent', () => {
    const manifest = makeManifest({ app: { connect: undefined } });
    const result = checkManifest(manifest);
    expect(result.errors.find(e => e.id === 'E002')).toBeUndefined();
  });
});

// ─── E003: app.connect.key absent ─────────────────────────────────────────

describe('E003: app.connect.key absent', () => {
  it('raises E003 when app.connect.key is missing', () => {
    const manifest = makeManifest({ app: { connect: undefined } });
    const result = checkManifest(manifest);
    const e003 = result.errors.find(e => e.id === 'E003');
    expect(e003).toBeDefined();
    expect(e003?.severity).toBe('error');
  });

  it('raises E003 when app.connect exists but key is absent', () => {
    const manifest = makeManifest({ app: { connect: { remote: 'foo' } } });
    const result = checkManifest(manifest);
    expect(result.errors.find(e => e.id === 'E003')).toBeDefined();
  });

  it('does not raise E003 when app.connect.key is present', () => {
    const result = checkManifest(VALID_MANIFEST);
    expect(result.errors.find(e => e.id === 'E003')).toBeUndefined();
  });

  it('uses gone-too-far remediation when E003 is the only error', () => {
    const manifest = makeManifest({ app: { connect: undefined } });
    const result = checkManifest(manifest);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('E003');
    expect(result.errors[0].remediation).toMatch(/gone too far|already fully migrated/i);
    expect(result.summary).toMatch(/gone too far/i);
  });

  it('uses standard E003 remediation when other errors are also present', () => {
    const manifest = makeManifest({
      app: { connect: undefined },
      connectModules: { 'jira:issuePanel': [{ key: 'old' }] },
    });
    const result = checkManifest(manifest);
    const e003 = result.errors.find(e => e.id === 'E003');
    expect(e003?.remediation).not.toMatch(/gone too far|already fully migrated/i);
  });
});

// ─── E004: Connect-style scopes ───────────────────────────────────────────

describe('E004: Connect-style scopes', () => {
  it('raises E004 for :connect-jira scopes', () => {
    const manifest = makeManifest({
      permissions: { scopes: ['read:connect-jira', 'write:connect-jira'] },
    });
    const result = checkManifest(manifest);
    const e004 = result.errors.find(e => e.id === 'E004');
    expect(e004).toBeDefined();
    expect(e004?.detail?.scopes).toContain('read:connect-jira');
    expect(e004?.detail?.scopes).toContain('write:connect-jira');
  });

  it('raises E004 for :connect-confluence scopes', () => {
    const manifest = makeManifest({
      permissions: { scopes: ['read:connect-confluence'] },
    });
    const result = checkManifest(manifest);
    expect(result.errors.find(e => e.id === 'E004')).toBeDefined();
  });

  it('does not raise E004 for native Forge scopes', () => {
    const result = checkManifest(VALID_MANIFEST);
    expect(result.errors.find(e => e.id === 'E004')).toBeUndefined();
  });
});

// ─── W002: placeholder app ID ─────────────────────────────────────────────

describe('W002: placeholder app ID', () => {
  it('raises W002 when app.id is the placeholder value', () => {
    const manifest = makeManifest({
      app: { id: 'ari:cloud:ecosystem::app/invalid-run-forge-register', connect: { key: 'my-connect-app-key' } },
    });
    const result = checkManifest(manifest);
    const w002 = result.warnings.find(w => w.id === 'W002');
    expect(w002).toBeDefined();
    expect(w002?.severity).toBe('warning');
  });

  it('does not raise W002 for a real app ID', () => {
    const result = checkManifest(VALID_MANIFEST);
    expect(result.warnings.find(w => w.id === 'W002')).toBeUndefined();
  });
});

// ─── W003: Connect-style context parameter tokens ─────────────────────────

describe('W003: Connect-style context parameter tokens', () => {
  it('raises W003 when a module contains {issue.key} style tokens', () => {
    const manifest = makeManifest({
      modules: {
        'jira:issuePanel': [{ key: 'my-panel', url: '/panel?issue={issue.key}' }],
      },
    });
    const result = checkManifest(manifest);
    const w003 = result.warnings.find(w => w.id === 'W003');
    expect(w003).toBeDefined();
    expect(w003?.severity).toBe('warning');
  });

  it('raises W003 for tokens in connectModules too', () => {
    const manifest = makeManifest({
      connectModules: {
        'jira:issuePanel': [{ key: 'old', url: '/old?page={page.id}' }],
      },
    });
    const result = checkManifest(manifest);
    expect(result.warnings.find(w => w.id === 'W003')).toBeDefined();
  });

  it('does not raise W003 when no tokens are present', () => {
    const result = checkManifest(VALID_MANIFEST);
    expect(result.warnings.find(w => w.id === 'W003')).toBeUndefined();
  });
});

// ─── Summary states ───────────────────────────────────────────────────────

describe('adoption summary states', () => {
  it('is fullyAdopted with no errors or warnings', () => {
    const result = checkManifest(VALID_MANIFEST);
    expect(result.fullyAdopted).toBe(true);
    expect(result.summary).toMatch(/fully adopted/i);
  });

  it('reports unstarted when only connectModules are present and no native modules', () => {
    const manifest: ForgeManifest = {
      ...VALID_MANIFEST,
      connectModules: { 'jira:issuePanel': [{ key: 'old' }] },
      modules: undefined,
    };
    const result = checkManifest(manifest);
    expect(result.fullyAdopted).toBe(false);
    expect(result.summary).toMatch(/registered on Forge but no modules/i);
  });

  it('reports partial adoption when both connectModules and native modules are present', () => {
    const manifest = makeManifest({
      connectModules: { 'jira:issuePanel': [{ key: 'old' }] },
    });
    const result = checkManifest(manifest);
    expect(result.fullyAdopted).toBe(false);
    expect(result.summary).toMatch(/partially adopted/i);
  });
});

// ─── parseManifest ────────────────────────────────────────────────────────

describe('parseManifest', () => {
  it('parses valid YAML into a ForgeManifest', () => {
    const yaml = `
app:
  id: ari:cloud:ecosystem::app/test
  connect:
    key: my-key
  runtime:
    name: nodejs18.x
permissions:
  scopes: []
`;
    const manifest = parseManifest(yaml, 'test.yml');
    expect(manifest.app.id).toBe('ari:cloud:ecosystem::app/test');
    expect(manifest.app.connect?.key).toBe('my-key');
  });

  it('throws on invalid YAML', () => {
    expect(() => parseManifest('{ invalid: yaml: here', 'bad.yml')).toThrow(/bad\.yml/);
  });
});
