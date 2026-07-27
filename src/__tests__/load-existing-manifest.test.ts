import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadExistingManifest } from '../convert';

// ─── loadExistingManifest() ───────────────────────────────────────────────
//
// See AI-Planning/04-code-review-bugs-and-improvements.md item #2.
//
// loadExistingManifest() returns a discriminated union describing exactly what
// happened, and NEVER throws. This keeps it a pure, easily-testable function
// and lets the caller (runConvert) decide how to react to each case:
//
//   1. file missing (ENOENT)         -> { status: 'missing' }
//   2. file present + valid YAML      -> { status: 'found', manifest }
//   3. file present but not readable  -> { status: 'unreadable', error }
//   4. file present but invalid YAML  -> { status: 'unparseable', error }
//
// The original bug was that ANY error collapsed to a single "not found" result,
// which let runConvert silently overwrite a real (but broken) user file.

describe('loadExistingManifest()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2f-load-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns status "missing" for a genuinely missing file', () => {
    const missing = path.join(tmpDir, 'does-not-exist.yml');
    const result = loadExistingManifest(missing);
    expect(result.status).toBe('missing');
  });

  it('returns status "found" with the parsed manifest for a valid file', () => {
    const file = path.join(tmpDir, 'manifest.yml');
    fs.writeFileSync(
      file,
      ['app:', '  id: ari:cloud:ecosystem::app/real', '  connect:', '    key: com.example.app'].join('\n')
    );
    const result = loadExistingManifest(file);
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.manifest.app.connect!.key).toBe('com.example.app');
    }
  });

  it('returns status "unparseable" (with an error) for a malformed present file', () => {
    const file = path.join(tmpDir, 'manifest.yml');
    // Invalid YAML (a tab-indented, unterminated flow sequence).
    fs.writeFileSync(file, 'app:\n\tid: [unterminated');

    // The file clearly EXISTS on disk...
    expect(fs.existsSync(file)).toBe(true);

    const result = loadExistingManifest(file);
    // ...and the parse failure is reported as data (not thrown, not "missing")
    // so the caller can refuse to clobber this real, user-authored file.
    expect(result.status).toBe('unparseable');
    if (result.status === 'unparseable') {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toMatch(/could not parse|YAML/i);
    }
  });

  it('returns status "unreadable" (with an error) for a non-ENOENT IO error', () => {
    // A path that exists but is a directory yields EISDIR (not ENOENT) on read,
    // which must be distinguished from a missing file.
    const dirAsFile = path.join(tmpDir, 'a-directory');
    fs.mkdirSync(dirAsFile);

    const result = loadExistingManifest(dirAsFile);
    expect(result.status).toBe('unreadable');
    if (result.status === 'unreadable') {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toMatch(/could not read/i);
    }
  });

  it('never throws, regardless of input', () => {
    const missing = path.join(tmpDir, 'nope.yml');
    const dirAsFile = path.join(tmpDir, 'dir');
    fs.mkdirSync(dirAsFile);
    const bad = path.join(tmpDir, 'bad.yml');
    fs.writeFileSync(bad, 'app:\n\tid: [unterminated');

    expect(() => loadExistingManifest(missing)).not.toThrow();
    expect(() => loadExistingManifest(dirAsFile)).not.toThrow();
    expect(() => loadExistingManifest(bad)).not.toThrow();
  });
});
