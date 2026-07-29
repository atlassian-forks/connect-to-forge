// Connect permission as it appears in the descriptor — name/description may be
// a plain string or a localisation object { value: string }
export interface ConnectPermission {
  key: string;
  name: string | { value: string };
  description?: string | { value: string };
  [key: string]: any;
}

// Normalised permission after migration to Forge — name/description are plain strings
export interface NormalisedPermission {
  key: string;
  name: string;
  description?: string;
  migratedFromConnect: true;
  [key: string]: any;
}

// A Connect webhook entry from the descriptor — no key field, that is assigned by us
export interface ConnectWebhook {
  event: string;
  url: string;
  [key: string]: any;
}

// A webhook after assignWebhookKeys() has been applied
export interface ConnectWebhookWithKey extends ConnectWebhook {
  key: string;
}

// Typings for Atlassian Connect Descriptor
export interface ConnectDescriptor {
  name: string;
  key: string;
  baseUrl: string;
  scopes: string[];
  lifecycle?: Record<string, string>;
  modules: {
    jiraGlobalPermissions?: ConnectPermission[];
    jiraProjectPermissions?: ConnectPermission[];
    webhooks?: ConnectWebhook[];
    [key: string]: any;
  };
  translations?: Record<string, any>;
  regionBaseUrls?: Record<string, any>;
  cloudAppMigration?: Record<string, string>;
  enableLicensing?: boolean;
  editionsEnabled?: boolean;
  dataResidency?: {
    maxMigrationDurationHours: number;
  };
}

// Typings for Forge manifest
export interface ForgeManifest {
  app: {
    id: string;
    connect?: {
      key?: string;
      remote?: string;
      authentication?: string;
      [key: string]: any;
    };
    runtime: {
      name: string;
    };
    licensing?: {
      enabled: boolean;
      editionsEnabled?: boolean;
    };
  };
  remotes?: {
    key: string;
    baseUrl: string | Record<string, any>;
    storage?: {
      inScopeEUD: boolean;
    };
    operations?: string[];
  }[];
  modules?: Record<string, any>;
  connectModules?: Record<string, any>;
  permissions: {
    scopes: string[];
  };
}

// Typings for adoption status check results
export interface CheckIssue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  detail?: Record<string, any>;
  remediation: string;
}

export interface AdoptionStatusResult {
  fullyAdopted: boolean;
  summary: string;
  errors: CheckIssue[];
  warnings: CheckIssue[];
}
