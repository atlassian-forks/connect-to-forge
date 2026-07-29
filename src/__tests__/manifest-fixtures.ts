import { ConnectDescriptor, ForgeManifest } from '../types';

// ─── Forge manifest fixtures ──────────────────────────────────────────────

export const cleanForgeManifest: ForgeManifest = {
  app: {
    id: 'ari:cloud:ecosystem::app/real-app-id',
    connect: { key: 'com.example.app' },
    runtime: { name: 'nodejs20.x' },
  },
  permissions: { scopes: ['read:jira-work'] },
};

export const connectOnForgeManifest: ForgeManifest = {
  app: {
    id: 'ari:cloud:ecosystem::app/invalid-run-forge-register',
    connect: { key: 'com.example.app', remote: 'connect' },
    runtime: { name: 'nodejs20.x' },
  },
  connectModules: { 'jira:webPanels': [{ key: 'panel', url: '/panel' }] },
  remotes: [{ key: 'connect', baseUrl: 'https://example.com' }],
  permissions: { scopes: ['read:connect-jira'] },
};

// ─── Connect descriptor fixtures ─────────────────────────────────────────

export const minimalConnectDescriptor: ConnectDescriptor = {
  name: 'Test App',
  key: 'com.example.test',
  baseUrl: 'https://example.com',
  scopes: [],
  modules: {},
};

export const jiraConnectDescriptor: ConnectDescriptor = {
  name: 'My Jira App',
  key: 'com.example.jira',
  baseUrl: 'https://example.com',
  scopes: ['READ', 'WRITE'],
  modules: {
    webPanels: [{ key: 'my-panel', url: '/panel', location: 'atl.jira.view.issue.left.context' }],
  },
};

export const confluenceConnectDescriptor: ConnectDescriptor = {
  name: 'My Confluence App',
  key: 'com.example.confluence',
  baseUrl: 'https://example.com',
  scopes: ['READ'],
  modules: {
    staticContentMacro: [{ key: 'my-macro', name: { value: 'My Macro' }, url: '/macro' }],
  },
};

// A default Forge manifest as produced by genDefaultManifest() — used as the
// starting point for buildForgeManifest() tests
export function makeDefaultManifest(baseUrl = 'https://example.com'): ForgeManifest {
  return {
    app: {
      id: 'ari:cloud:ecosystem::app/invalid-run-forge-register',
      connect: { key: 'com.example.test', remote: 'connect' },
      runtime: { name: 'nodejs20.x' },
    },
    remotes: [{ key: 'connect', baseUrl }],
    connectModules: {},
    permissions: { scopes: [] },
  };
}
