/**
 * Unit tests for npm.ts
 *
 * Tests the npm package download and extraction logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadNpmPackage, NpmDownloadError } from '../src/npm.ts';
import { parseAddOptions } from '../src/add.ts';
import { existsSync } from 'fs';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock tar
vi.mock('tar', () => ({
  default: { extract: vi.fn().mockResolvedValue(undefined) },
}));

// Mock fs (existsSync)
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

// Mock fs/promises
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    mkdtemp: vi.fn().mockResolvedValue('/tmp/skills-npm-abc123'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  };
});

const mockExistsSync = vi.mocked(existsSync);

describe('downloadNpmPackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('throws NpmDownloadError when package metadata fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(downloadNpmPackage('nonexistent-pkg')).rejects.toThrow(
      /Failed to fetch package metadata/
    );
  });

  it('throws NpmDownloadError when version cannot be resolved', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'dist-tags': {},
        versions: {},
      }),
    });

    await expect(downloadNpmPackage('some-pkg')).rejects.toThrow(/Could not resolve version/);
  });

  it('throws NpmDownloadError when no tarball URL found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': { dist: {} },
        },
      }),
    });

    await expect(downloadNpmPackage('some-pkg')).rejects.toThrow(/No tarball found/);
  });

  it('resolves dist-tag version (e.g., latest) to actual version', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '2.0.0', beta: '3.0.0-beta.1' },
          versions: {
            '2.0.0': {
              dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-2.0.0.tgz' },
            },
            '3.0.0-beta.1': {
              dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-3.0.0-beta.1.tgz' },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

    const result = await downloadNpmPackage('pkg', 'beta');
    expect(result.dir).toBe('/tmp/skills-npm-abc123/package');
    expect(result.tempDir).toBe('/tmp/skills-npm-abc123');
    expect(mockFetch).toHaveBeenCalledWith('https://registry.npmjs.org/pkg');
    expect(mockFetch).toHaveBeenCalledWith('https://registry.npmjs.org/pkg/-/pkg-3.0.0-beta.1.tgz');
    await result.cleanup();
  });

  it('uses custom registry URL', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              dist: { tarball: 'https://custom.registry.com/pkg/-/pkg-1.0.0.tgz' },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

    const result = await downloadNpmPackage('pkg', undefined, 'https://custom.registry.com');
    expect(mockFetch).toHaveBeenCalledWith('https://custom.registry.com/pkg');
    await result.cleanup();
  });

  it('URL-encodes scoped package names for registry API', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              dist: { tarball: 'https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz' },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

    const result = await downloadNpmPackage('@scope/pkg');
    // The slash in @scope/pkg should be encoded as %2F
    expect(mockFetch).toHaveBeenCalledWith('https://registry.npmjs.org/@scope%2Fpkg');
    await result.cleanup();
  });

  it('downloads and extracts package successfully', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              dist: { tarball: 'https://registry.npmjs.org/my-skill/-/my-skill-1.0.0.tgz' },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
      });

    const result = await downloadNpmPackage('my-skill');
    expect(result.dir).toBe('/tmp/skills-npm-abc123/package');
    expect(result.tempDir).toBe('/tmp/skills-npm-abc123');
    expect(typeof result.cleanup).toBe('function');
    await result.cleanup();
  });

  it('throws NpmDownloadError when tarball download fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz' },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

    await expect(downloadNpmPackage('pkg')).rejects.toThrow(/Failed to download tarball/);
  });

  it('throws NpmDownloadError when extracted tarball has no package/ directory', async () => {
    mockExistsSync.mockReturnValue(false);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz' },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
      });

    await expect(downloadNpmPackage('pkg')).rejects.toThrow(
      /Extracted tarball does not contain a "package" directory/
    );
  });
});

describe('NpmDownloadError', () => {
  it('has correct name and packageName', () => {
    const error = new NpmDownloadError('test error', '@scope/pkg');
    expect(error.name).toBe('NpmDownloadError');
    expect(error.packageName).toBe('@scope/pkg');
    expect(error.message).toBe('test error');
  });
});

describe('parseAddOptions --registry', () => {
  it('should parse --registry flag with separate value', () => {
    const { options } = parseAddOptions(['npm:foo', '--registry', 'https://my-registry.com']);
    expect(options.registry).toBe('https://my-registry.com');
  });

  it('should parse --registry= flag with inline value', () => {
    const { options } = parseAddOptions(['npm:foo', '--registry=https://my-registry.com']);
    expect(options.registry).toBe('https://my-registry.com');
  });

  it('should not set registry when flag is absent', () => {
    const { options } = parseAddOptions(['npm:foo', '-g', '-y']);
    expect(options.registry).toBeUndefined();
  });

  it('should parse source alongside --registry', () => {
    const { source, options } = parseAddOptions([
      'npm:@scope/pkg',
      '--registry',
      'https://r.com',
      '-g',
    ]);
    expect(source).toEqual(['npm:@scope/pkg']);
    expect(options.registry).toBe('https://r.com');
    expect(options.global).toBe(true);
  });
});
