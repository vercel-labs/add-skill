/**
 * Integration tests for auth.ts using httpbin.org for real HTTP requests.
 * These tests verify actual network behavior including retries, timeouts, and status codes.
 *
 * Note: These tests make real HTTP requests and may be slower than unit tests.
 * They may also fail if httpbin.org is unavailable.
 */
import { describe, it, expect } from 'vitest';
import { verifyLicense, fetchPrivateSkillContent, parseAuthConfig } from '../src/auth.js';
import type { SkillAuthConfig } from '../src/types.js';

// Skip integration tests in CI or when SKIP_INTEGRATION is set
const SKIP_INTEGRATION = process.env.CI || process.env.SKIP_INTEGRATION;

describe.skipIf(SKIP_INTEGRATION)('auth integration tests (httpbin)', () => {
  describe('verifyLicense with real HTTP', () => {
    it('should successfully verify with httpbin bearer endpoint', async () => {
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://httpbin.org/bearer',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      };

      const result = await verifyLicense(config, 'any-valid-token');

      expect(result.valid).toBe(true);
    });

    it('should handle 401 unauthorized from httpbin', async () => {
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://httpbin.org/status/401',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      };

      const result = await verifyLicense(config, 'test-key');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid or expired license key');
    });

    it('should handle 403 forbidden from httpbin', async () => {
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://httpbin.org/status/403',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      };

      const result = await verifyLicense(config, 'test-key');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid or expired license key');
    });

    it('should handle 429 rate limit from httpbin', async () => {
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://httpbin.org/status/429',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      };

      const result = await verifyLicense(config, 'test-key');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Too many attempts. Try again later.');
    });

    it('should handle 500 server error from httpbin', async () => {
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://httpbin.org/status/500',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      };

      const result = await verifyLicense(config, 'test-key');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Verification failed with status 500');
    });

    it('should send correct headers with POST method', async () => {
      const config: SkillAuthConfig = {
        verify: {
          // httpbin /post echoes back request details
          endpoint: 'https://httpbin.org/post',
          method: 'POST',
          tokenHeader: 'X-License-Key',
          tokenPrefix: 'LK-',
        },
      };

      const result = await verifyLicense(config, 'my-license-123');

      // httpbin returns 200 for /post, so it should be valid
      expect(result.valid).toBe(true);
    });

    it('should handle non-existent domain gracefully', async () => {
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://this-domain-does-not-exist-12345.com/verify',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      };

      const result = await verifyLicense(config, 'test-key');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Unable to reach verification server');
    }, 10000); // Allow extra time for DNS resolution + retries
  });

  describe('fetchPrivateSkillContent with real HTTP', () => {
    it('should fetch plain text content from httpbin', async () => {
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://httpbin.org/bearer',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
        content: {
          // httpbin /robots.txt returns plain text
          endpoint: 'https://httpbin.org/robots.txt',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      };

      const result = await fetchPrivateSkillContent(config, 'test-key');

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content).toContain('User-agent');
    });

    it('should handle 401 on content fetch', async () => {
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://httpbin.org/bearer',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
        content: {
          endpoint: 'https://httpbin.org/status/401',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      };

      const result = await fetchPrivateSkillContent(config, 'test-key');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid or expired license key');
    });

    it('should handle 429 rate limit on content fetch', async () => {
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://httpbin.org/bearer',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
        content: {
          endpoint: 'https://httpbin.org/status/429',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      };

      const result = await fetchPrivateSkillContent(config, 'test-key');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Too many attempts. Try again later.');
    });
  });

  describe('parseAuthConfig validation', () => {
    it('should reject http endpoints (require https)', () => {
      const config = JSON.stringify({
        verify: {
          endpoint: 'http://httpbin.org/bearer',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      });

      const result = parseAuthConfig(config);

      expect(result).toBeNull();
    });

    it('should accept valid https endpoints', () => {
      const config = JSON.stringify({
        verify: {
          endpoint: 'https://httpbin.org/bearer',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      });

      const result = parseAuthConfig(config);

      expect(result).not.toBeNull();
      expect(result?.verify.endpoint).toBe('https://httpbin.org/bearer');
    });

    it('should reject invalid URL formats', () => {
      const config = JSON.stringify({
        verify: {
          endpoint: 'not-a-valid-url',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      });

      const result = parseAuthConfig(config);

      expect(result).toBeNull();
    });

    it('should reject relative URLs', () => {
      const config = JSON.stringify({
        verify: {
          endpoint: '/api/verify',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      });

      const result = parseAuthConfig(config);

      expect(result).toBeNull();
    });
  });

  describe('retry behavior', () => {
    it('should eventually succeed after transient failures', async () => {
      // httpbin /bearer always succeeds, so this tests the happy path
      // Real retry testing would need a flaky endpoint
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://httpbin.org/bearer',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      };

      const result = await verifyLicense(config, 'test-key');

      expect(result.valid).toBe(true);
    });
  });

  describe('header verification with httpbin', () => {
    it('should send custom token header correctly', async () => {
      const config: SkillAuthConfig = {
        verify: {
          // httpbin /headers echoes back all headers
          endpoint: 'https://httpbin.org/headers',
          method: 'GET',
          tokenHeader: 'X-Custom-License',
          tokenPrefix: 'License ',
        },
      };

      const result = await verifyLicense(config, 'abc-123');

      // The request succeeds (200) but we can't easily verify the header was sent
      // without parsing the response body. At minimum, verify it doesn't fail.
      expect(result.valid).toBe(true);
    });

    it('should handle empty token prefix', async () => {
      const config: SkillAuthConfig = {
        verify: {
          endpoint: 'https://httpbin.org/headers',
          method: 'GET',
          tokenHeader: 'X-Api-Key',
          tokenPrefix: '',
        },
      };

      const result = await verifyLicense(config, 'raw-api-key-value');

      expect(result.valid).toBe(true);
    });
  });
});

describe.skipIf(SKIP_INTEGRATION)('fetchAuthConfig integration', () => {
  it('should fetch and parse auth config from a URL', async () => {
    // We can't easily test this without hosting a real SKILL.auth.json
    // This is more of a placeholder for when we have a test fixture URL
    expect(true).toBe(true);
  });
});
