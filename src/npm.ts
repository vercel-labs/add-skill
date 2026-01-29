import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import tar from 'tar';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export class NpmDownloadError extends Error {
  readonly packageName: string;

  constructor(message: string, packageName: string) {
    super(message);
    this.name = 'NpmDownloadError';
    this.packageName = packageName;
  }
}

interface NpmPackageResult {
  /** Path to extracted package contents (the "package/" subdirectory) */
  dir: string;
  /** Path to the temporary directory (parent of dir, for cleanup) */
  tempDir: string;
  /** Cleanup function to remove the temporary directory */
  cleanup: () => Promise<void>;
}

/**
 * Download and extract an npm package to a temporary directory.
 *
 * 1. Fetches package metadata from the registry
 * 2. Downloads the tarball
 * 3. Extracts it using `tar`
 * 4. Returns the path to the extracted contents
 */
export async function downloadNpmPackage(
  packageName: string,
  version?: string,
  registry?: string
): Promise<NpmPackageResult> {
  const registryUrl = (registry || DEFAULT_REGISTRY).replace(/\/$/, '');
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-npm-'));

  const cleanupFn = async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    // Fetch package metadata to get the tarball URL
    // Scoped packages need URL encoding: @scope/pkg → @scope%2Fpkg
    const encodedName = packageName.startsWith('@')
      ? `@${encodeURIComponent(packageName.slice(1))}`
      : packageName;
    const metadataUrl = `${registryUrl}/${encodedName}`;
    const res = await fetch(metadataUrl);

    if (!res.ok) {
      throw new NpmDownloadError(
        `Failed to fetch package metadata: ${res.status} ${res.statusText}`,
        packageName
      );
    }

    const metadata = (await res.json()) as {
      'dist-tags'?: Record<string, string>;
      versions?: Record<string, { dist?: { tarball?: string } }>;
    };

    // Resolve the version
    const resolvedVersion = version
      ? metadata['dist-tags']?.[version] || version
      : metadata['dist-tags']?.['latest'];

    if (!resolvedVersion) {
      throw new NpmDownloadError(`Could not resolve version for ${packageName}`, packageName);
    }

    const versionData = metadata.versions?.[resolvedVersion];
    if (!versionData?.dist?.tarball) {
      throw new NpmDownloadError(
        `No tarball found for ${packageName}@${resolvedVersion}`,
        packageName
      );
    }

    const tarballUrl = versionData.dist.tarball;

    // Download the tarball
    const tarballRes = await fetch(tarballUrl);
    if (!tarballRes.ok) {
      throw new NpmDownloadError(
        `Failed to download tarball: ${tarballRes.status} ${tarballRes.statusText}`,
        packageName
      );
    }

    const tarballPath = join(tempDir, 'package.tgz');
    const arrayBuffer = await tarballRes.arrayBuffer();
    await writeFile(tarballPath, Buffer.from(arrayBuffer));

    // Extract the tarball
    await tar.extract({ file: tarballPath, cwd: tempDir });

    // npm tarballs extract to a "package/" subdirectory
    const packageDir = join(tempDir, 'package');

    if (!existsSync(packageDir)) {
      throw new NpmDownloadError(
        `Extracted tarball does not contain a "package" directory for ${packageName}`,
        packageName
      );
    }

    return {
      dir: packageDir,
      tempDir,
      cleanup: cleanupFn,
    };
  } catch (error) {
    await cleanupFn();
    if (error instanceof NpmDownloadError) {
      throw error;
    }
    throw new NpmDownloadError(
      `Failed to download npm package ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
      packageName
    );
  }
}
