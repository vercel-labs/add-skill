import { mkdirSync, writeFileSync, unlinkSync, rmSync, existsSync } from 'fs';
import { isAbsolute, normalize, join, sep } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import * as tar from 'tar';
import type { SkillAuthConfig, AuthEndpointConfig, LicenseVerificationResult } from './types.js';

/** Default timeout for auth-related fetch requests (30 seconds) */
const FETCH_TIMEOUT_MS = 30000;

/** Maximum number of retry attempts for network errors */
const MAX_RETRIES = 2;

/** Initial backoff delay in ms (doubles with each retry) */
const INITIAL_BACKOFF_MS = 500;

/** Track extracted directories for cleanup */
const extractedDirectories = new Set<string>();

/**
 * Cleanup all extracted tarball directories.
 * Call this after installation is complete (success or failure).
 */
export function cleanupExtractedDirectories(): void {
  for (const dir of extractedDirectories) {
    try {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
  extractedDirectories.clear();
}

/**
 * Check if an error is a retryable network error.
 */
function isRetryableError(error: unknown): boolean {
  // Retry on network errors (TypeError from fetch)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  // Don't retry timeouts - they indicate server issues
  return false;
}

/**
 * Create a fetch request with timeout and retry logic.
 * Retries on network errors with exponential backoff.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      // Only retry on retryable errors
      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      // Exponential backoff: 500ms, 1000ms
      const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError;
}

/**
 * Result of fetching private skill content.
 * Either `content` (for plain text) or `extractedPath` (for tarball) will be set.
 */
export interface FetchContentResult {
  success: boolean;
  /** Plain text content (SKILL.md only) */
  content?: string;
  /** Path to extracted tarball directory (multi-file skills) */
  extractedPath?: string;
  error?: string;
}

/**
 * Check if data starts with gzip magic bytes (0x1f 0x8b).
 */
function isGzipData(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

/**
 * Extract a tarball buffer to a temporary directory.
 * The directory is tracked for cleanup via cleanupExtractedDirectories().
 */
async function extractTarball(data: Uint8Array): Promise<string> {
  const extractDir = join(tmpdir(), `skill-content-${randomUUID()}`);
  mkdirSync(extractDir, { recursive: true });

  // Track for cleanup
  extractedDirectories.add(extractDir);

  // Write tarball to temp file
  const tarballPath = join(extractDir, 'skill.tar.gz');
  writeFileSync(tarballPath, data);

  // Extract using tar package
  await tar.extract({
    file: tarballPath,
    cwd: extractDir,
    strict: true,
    filter: (entryPath) => {
      const normalized = normalize(entryPath).replace(/^(\.\.[/\\])+/, '');
      if (isAbsolute(entryPath)) return false;
      if (normalized.startsWith('..' + sep) || normalized === '..') return false;
      const resolved = join(extractDir, normalized);
      return resolved.startsWith(extractDir + sep) || resolved === extractDir;
    },
  });

  // Remove the tarball file after extraction to save disk space
  try {
    unlinkSync(tarballPath);
  } catch {
    // Ignore deletion errors
  }

  return extractDir;
}

/**
 * Check if a skill is marked as private based on its metadata.
 * @param metadata - The metadata object from SKILL.md frontmatter
 * @returns true if the skill has access: "private"
 */
export function isPrivateSkill(metadata?: Record<string, unknown>): boolean {
  return metadata?.access === 'private';
}

/**
 * Validate an endpoint configuration object.
 */
function validateEndpointConfig(obj: unknown): AuthEndpointConfig | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  const config = obj as Record<string, unknown>;

  if (typeof config.endpoint !== 'string' || !config.endpoint) {
    return null;
  }

  // Validate endpoint is a valid HTTPS URL
  try {
    const url = new URL(config.endpoint);
    if (url.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }

  if (config.method !== 'GET' && config.method !== 'POST') {
    return null;
  }

  if (typeof config.tokenHeader !== 'string' || !config.tokenHeader) {
    return null;
  }

  if (typeof config.tokenPrefix !== 'string') {
    return null;
  }

  return {
    endpoint: config.endpoint,
    method: config.method,
    tokenHeader: config.tokenHeader,
    tokenPrefix: config.tokenPrefix,
  };
}

/**
 * Parse and validate SKILL.auth.json content.
 * @param content - Raw JSON string content
 * @returns Parsed SkillAuthConfig or null if invalid
 */
export function parseAuthConfig(content: string): SkillAuthConfig | null {
  try {
    const parsed = JSON.parse(content) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const config = parsed as Record<string, unknown>;

    // Validate verify object (required)
    const verify = validateEndpointConfig(config.verify);
    if (!verify) {
      return null;
    }

    // Validate content object (optional)
    let contentConfig: AuthEndpointConfig | undefined;
    if (config.content !== undefined) {
      const validated = validateEndpointConfig(config.content);
      if (!validated) {
        return null; // If content is provided, it must be valid
      }
      contentConfig = validated;
    }

    return {
      verify,
      content: contentConfig,
    };
  } catch {
    return null;
  }
}

/**
 * Verify a license key against the skill author's verification endpoint.
 * @param authConfig - The auth configuration from SKILL.auth.json
 * @param licenseKey - The license key to verify
 * @returns Verification result with valid status and optional error/expiry
 */
export async function verifyLicense(
  authConfig: SkillAuthConfig,
  licenseKey: string
): Promise<LicenseVerificationResult> {
  const { endpoint, method, tokenHeader, tokenPrefix } = authConfig.verify;

  try {
    const headers: Record<string, string> = {
      [tokenHeader]: `${tokenPrefix}${licenseKey}`,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetchWithTimeout(endpoint, {
      method,
      headers,
    });

    // Handle specific error status codes
    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        error: 'Invalid or expired license key',
      };
    }

    if (response.status === 429) {
      return {
        valid: false,
        error: 'Too many attempts. Try again later.',
      };
    }

    if (!response.ok) {
      return {
        valid: false,
        error: `Verification failed with status ${response.status}`,
      };
    }

    // Try to parse response for additional info
    try {
      const data = (await response.json()) as Record<string, unknown>;

      // Check if response explicitly says invalid
      if (data.valid === false) {
        return {
          valid: false,
          error: typeof data.error === 'string' ? data.error : 'License validation failed',
        };
      }

      return {
        valid: true,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
      };
    } catch {
      // If we can't parse JSON but got 2xx, assume valid
      return { valid: true };
    }
  } catch (error) {
    // Timeout errors
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        valid: false,
        error: 'Verification request timed out',
      };
    }

    // Network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return {
        valid: false,
        error: 'Unable to reach verification server',
      };
    }

    return {
      valid: false,
      error: 'Unable to reach verification server',
    };
  }
}

/**
 * Fetch auth config for a private skill.
 * This is a shared helper used by all providers.
 * @param authConfigUrl - URL to the SKILL.auth.json file
 * @returns Parsed SkillAuthConfig or undefined if not available/invalid
 */
export async function fetchAuthConfig(authConfigUrl: string): Promise<SkillAuthConfig | undefined> {
  try {
    const response = await fetch(authConfigUrl);
    if (response.ok) {
      const content = await response.text();
      const parsed = parseAuthConfig(content);
      if (parsed) {
        return parsed;
      }
    }
  } catch {
    // Auth config fetch failed - will be handled during installation
  }
  return undefined;
}

/**
 * Fetch protected skill content from the author's content endpoint.
 * Supports both plain text (SKILL.md only) and tarball (multi-file skills) responses.
 * @param authConfig - The auth configuration from SKILL.auth.json
 * @param licenseKey - The verified license key
 * @returns The skill content (text) or extracted path (tarball)
 */
export async function fetchPrivateSkillContent(
  authConfig: SkillAuthConfig,
  licenseKey: string
): Promise<FetchContentResult> {
  if (!authConfig.content) {
    return {
      success: false,
      error: 'No content endpoint configured',
    };
  }

  const { endpoint, method, tokenHeader, tokenPrefix } = authConfig.content;

  try {
    const headers: Record<string, string> = {
      [tokenHeader]: `${tokenPrefix}${licenseKey}`,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetchWithTimeout(endpoint, {
      method,
      headers,
    });

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: 'Invalid or expired license key',
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'Too many attempts. Try again later.',
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch content (status ${response.status})`,
      };
    }

    // Get response as array buffer to check for tarball
    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    if (data.length === 0) {
      return {
        success: false,
        error: 'Content endpoint returned empty response',
      };
    }

    // Check if response is a gzip tarball
    if (isGzipData(data)) {
      try {
        const extractedPath = await extractTarball(data);
        return {
          success: true,
          extractedPath,
        };
      } catch (extractError) {
        return {
          success: false,
          error: 'Failed to extract skill tarball',
        };
      }
    }

    // Otherwise, treat as plain text
    const content = new TextDecoder().decode(data);

    if (!content.trim()) {
      return {
        success: false,
        error: 'Content endpoint returned empty response',
      };
    }

    return {
      success: true,
      content,
    };
  } catch (error) {
    // Timeout errors
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: 'Content fetch request timed out',
      };
    }

    return {
      success: false,
      error: 'Unable to reach content server',
    };
  }
}
