# Proposal 05 — Handle Object Form of `permissions.scopes` in Forge Manifests

## Status

Proposed

## Problem

The Forge manifest supports two distinct formats for `permissions.scopes`:

**Simple array (currently handled):**
```yaml
permissions:
  scopes:
    - read:jira-work
    - write:jira-work
```

**Map/object form (not currently handled):**
```yaml
permissions:
  scopes:
    read:confluence-content.summary:
      allowImpersonation: true
    write:confluence-content:
      allowImpersonation: false
    write:jira-work: {}
```

The map form is used when an app needs **offline user impersonation** (e.g. from a scheduled trigger). Each scope name is a key, with an optional `allowImpersonation` boolean. An empty map `{}` is valid and means `allowImpersonation: false`.

The tool currently assumes `permissions.scopes` is always a `string[]`. This causes failures in two places:

### 1. `adoption-status` — E004 check (Connect-style scopes)

```typescript
const connectScopes = (manifest.permissions?.scopes ?? []).filter(
  s => s.endsWith(':connect-jira') || s.endsWith(':connect-confluence')
);
```

If `manifest.permissions.scopes` is an object (`{ content: [...], experimental: [...] }`), calling `.filter()` on it throws a runtime error and the entire check crashes.

### 2. `convert.ts` — `buildForgeManifest()` scope assignment

```typescript
m.permissions.scopes = c.scopes.map(scope => normaliseConnectScope(scope, type));
```

When writing the normalised Connect scopes into the manifest, this always writes a flat array — even if the existing manifest already used the object form. This silently discards any existing `experimental` scopes and loses the structural distinction between `content` and `experimental`.

### 3. `types.ts` — `ForgeManifest.permissions.scopes`

```typescript
permissions: {
  scopes: string[];
};
```

The type does not reflect reality — it will incorrectly type-check object-form manifests as valid `string[]`.

---

## Proposed Solution

### Step 1 — Update `ForgeManifest` type in `types.ts`

Replace the narrow `string[]` type with a union that reflects both valid formats:

```typescript
// The value for each scope entry in the map form
export interface ScopeOptions {
  allowImpersonation?: boolean;
}

// The two valid formats for permissions.scopes in a Forge manifest:
// - string[] for standard scopes
// - Record<string, ScopeOptions> for offline user impersonation
export type ForgeScopes =
  | string[]
  | Record<string, ScopeOptions>;

// Typings for Forge manifest
export interface ForgeManifest {
  // ...
  permissions: {
    scopes: ForgeScopes;
    content?: {
      scripts?: string[];
      styles?: string[];
    };
  };
}
```

Note: `permissions.content` is a separate CSP section (for Custom UI script/style sources), not related to scopes.

### Step 2 — Add a `flattenScopes()` helper in `adoption-status.ts` or a shared `utils.ts`

A pure function that flattens either scope format into a single `string[]` for checking purposes:

```typescript
export function flattenScopes(scopes: ForgeScopes): string[] {
  if (Array.isArray(scopes)) {
    return scopes;
  }
  // Map form — scope names are the keys
  return Object.keys(scopes);
}
```

### Step 3 — Update the E004 check in `adoption-status.ts`

Replace the direct `.filter()` with `flattenScopes()`:

```typescript
const allScopes = flattenScopes(manifest.permissions?.scopes ?? []);
const connectScopes = allScopes.filter(
  s => s.endsWith(':connect-jira') || s.endsWith(':connect-confluence')
);
```

### Step 4 — Update `buildForgeManifest()` in `convert.ts`

When writing normalised Connect scopes into the manifest, preserve the map structure if the existing manifest already uses it. Connect scopes don't use impersonation, so they should be added with `allowImpersonation: false` (i.e. `{}`):

```typescript
if (isPresent(c.scopes) && c.scopes.length > 0) {
  const normalisedScopes = c.scopes.map(scope => normaliseConnectScope(scope, type));

  if (Array.isArray(m.permissions.scopes)) {
    // Simple array — append normalised scopes directly
    m.permissions.scopes = [...m.permissions.scopes, ...normalisedScopes];
  } else {
    // Map form — add each scope as a key with no impersonation
    const additionalScopes: Record<string, ScopeOptions> = {};
    for (const scope of normalisedScopes) {
      additionalScopes[scope] = {};
    }
    m.permissions.scopes = {
      ...m.permissions.scopes,
      ...additionalScopes,
    };
  }
}
```

### Step 5 — Update `genDefaultManifest()` in `convert.ts`

The default manifest initialises `permissions.scopes` as `[]`. This is fine — Connect-on-Forge apps start with a simple array and the object form is only relevant for apps that have already started using experimental APIs.

No change needed here.

### Step 6 — Update `checkManifest()` W002 and E004 checks in `adoption-status.ts`

The W001/E004 checks both currently iterate scopes as a flat array. Replace all direct scope access with `flattenScopes()`.

### Step 7 — Update tests

- Add `flattenScopes()` unit tests covering:
  - `string[]` passthrough — returned as-is
  - Map form with multiple scopes — returns scope names as `string[]`
  - Map form with `allowImpersonation: true` on some entries — all keys still returned
  - Empty map `{}` → `[]`

- Add E004 test cases for map-form scopes containing Connect-style scope names as keys
- Add `buildForgeManifest()` test verifying that when the existing manifest uses the map form, converted Connect scopes are merged in with empty `{}` values (no impersonation)

---

## Affected Files

| File | Change |
|---|---|
| `src/types.ts` | Add `ForgeScopes` union type, update `ForgeManifest.permissions.scopes` |
| `src/adoption-status.ts` | Add `flattenScopes()`, use it in E004 check |
| `src/convert.ts` | Update `buildForgeManifest()` scope assignment to preserve object form |
| `src/__tests__/adoption-status.test.ts` | Add `flattenScopes` and E004 object-form tests |
| `src/__tests__/convert.test.ts` | Add `buildForgeManifest` object-form scope preservation test |

---

## Scope & Effort

| Task | Effort |
|---|---|
| Update `ForgeScopes` type in `types.ts` | Trivial (15 min) |
| Add `flattenScopes()` helper | Trivial (15 min) |
| Update E004 check | Trivial (15 min) |
| Update `buildForgeManifest()` scope handling | Small (30 min) |
| Write tests | Small (1 hour) |
| **Total** | **~2 hours** |

---

## Out of Scope

- Validating that scope strings are known/valid Forge scopes — that is `forge lint`'s job
- Converting between array and object form based on user preference — we follow the existing manifest's structure
- The `experimental` scopes introduced by Connect (there are none — this is Forge-only)
