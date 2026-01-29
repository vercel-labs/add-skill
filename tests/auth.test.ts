import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isPrivateSkill,
  parseAuthConfig,
  verifyLicense,
  fetchPrivateSkillContent,
} from '../src/auth.js';
import type { SkillAuthConfig } from '../src/types.js';

describe('isPrivateSkill', () => {
  it('should return true when metadata.access is "private"', () => {
    expect(isPrivateSkill({ access: 'private' })).toBe(true);
  });

  it('should return false when metadata.access is not "private"', () => {
    expect(isPrivateSkill({ access: 'public' })).toBe(false);
    expect(isPrivateSkill({ access: 'open' })).toBe(false);
  });

  it('should return false when metadata.access is not set', () => {
    expect(isPrivateSkill({})).toBe(false);
    expect(isPrivateSkill({ other: 'value' })).toBe(false);
  });

  it('should return false when metadata is undefined', () => {
    expect(isPrivateSkill(undefined)).toBe(false);
  });
});

describe('parseAuthConfig', () => {
  it('should parse valid auth config', () => {
    const validConfig = JSON.stringify({
      verify: {
        endpoint: 'https://example.com/api/verify',
        method: 'GET',
        tokenHeader: 'Authorization',
        tokenPrefix: 'Bearer ',
      },
    });

    const result = parseAuthConfig(validConfig);
    expect(result).not.toBeNull();
    expect(result?.verify.endpoint).toBe('https://example.com/api/verify');
    expect(result?.verify.method).toBe('GET');
    expect(result?.verify.tokenHeader).toBe('Authorization');
    expect(result?.verify.tokenPrefix).toBe('Bearer ');
  });

  it('should parse POST method config', () => {
    const config = JSON.stringify({
      verify: {
        endpoint: 'https://example.com/api/verify',
        method: 'POST',
        tokenHeader: 'X-License-Key',
        tokenPrefix: '',
      },
    });

    const result = parseAuthConfig(config);
    expect(result?.verify.method).toBe('POST');
  });

  it('should return null for invalid JSON', () => {
    expect(parseAuthConfig('not valid json')).toBeNull();
    expect(parseAuthConfig('{')).toBeNull();
  });

  it('should return null when verify object is missing', () => {
    expect(parseAuthConfig(JSON.stringify({}))).toBeNull();
    expect(parseAuthConfig(JSON.stringify({ other: 'field' }))).toBeNull();
  });

  it('should return null when endpoint is missing or invalid', () => {
    expect(
      parseAuthConfig(
        JSON.stringify({
          verify: {
            method: 'GET',
            tokenHeader: 'Authorization',
            tokenPrefix: 'Bearer ',
          },
        })
      )
    ).toBeNull();

    expect(
      parseAuthConfig(
        JSON.stringify({
          verify: {
            endpoint: '',
            method: 'GET',
            tokenHeader: 'Authorization',
            tokenPrefix: 'Bearer ',
          },
        })
      )
    ).toBeNull();
  });

  it('should return null when method is invalid', () => {
    expect(
      parseAuthConfig(
        JSON.stringify({
          verify: {
            endpoint: 'https://example.com/api/verify',
            method: 'PUT',
            tokenHeader: 'Authorization',
            tokenPrefix: 'Bearer ',
          },
        })
      )
    ).toBeNull();

    expect(
      parseAuthConfig(
        JSON.stringify({
          verify: {
            endpoint: 'https://example.com/api/verify',
            tokenHeader: 'Authorization',
            tokenPrefix: 'Bearer ',
          },
        })
      )
    ).toBeNull();
  });

  it('should return null when tokenHeader is missing or invalid', () => {
    expect(
      parseAuthConfig(
        JSON.stringify({
          verify: {
            endpoint: 'https://example.com/api/verify',
            method: 'GET',
            tokenPrefix: 'Bearer ',
          },
        })
      )
    ).toBeNull();

    expect(
      parseAuthConfig(
        JSON.stringify({
          verify: {
            endpoint: 'https://example.com/api/verify',
            method: 'GET',
            tokenHeader: '',
            tokenPrefix: 'Bearer ',
          },
        })
      )
    ).toBeNull();
  });

  it('should return null when tokenPrefix is not a string', () => {
    expect(
      parseAuthConfig(
        JSON.stringify({
          verify: {
            endpoint: 'https://example.com/api/verify',
            method: 'GET',
            tokenHeader: 'Authorization',
            tokenPrefix: 123,
          },
        })
      )
    ).toBeNull();
  });

  it('should allow empty tokenPrefix', () => {
    const config = JSON.stringify({
      verify: {
        endpoint: 'https://example.com/api/verify',
        method: 'GET',
        tokenHeader: 'X-License-Key',
        tokenPrefix: '',
      },
    });

    const result = parseAuthConfig(config);
    expect(result?.verify.tokenPrefix).toBe('');
  });

  it('should parse config with content endpoint', () => {
    const config = JSON.stringify({
      verify: {
        endpoint: 'https://example.com/api/verify',
        method: 'GET',
        tokenHeader: 'Authorization',
        tokenPrefix: 'Bearer ',
      },
      content: {
        endpoint: 'https://example.com/api/skill-content',
        method: 'GET',
        tokenHeader: 'Authorization',
        tokenPrefix: 'Bearer ',
      },
    });

    const result = parseAuthConfig(config);
    expect(result).not.toBeNull();
    expect(result?.content).not.toBeUndefined();
    expect(result?.content?.endpoint).toBe('https://example.com/api/skill-content');
    expect(result?.content?.method).toBe('GET');
  });

  it('should return null when content endpoint is invalid', () => {
    const config = JSON.stringify({
      verify: {
        endpoint: 'https://example.com/api/verify',
        method: 'GET',
        tokenHeader: 'Authorization',
        tokenPrefix: 'Bearer ',
      },
      content: {
        endpoint: '', // invalid
        method: 'GET',
        tokenHeader: 'Authorization',
        tokenPrefix: 'Bearer ',
      },
    });

    const result = parseAuthConfig(config);
    expect(result).toBeNull();
  });

  it('should allow config without content endpoint', () => {
    const config = JSON.stringify({
      verify: {
        endpoint: 'https://example.com/api/verify',
        method: 'GET',
        tokenHeader: 'Authorization',
        tokenPrefix: 'Bearer ',
      },
    });

    const result = parseAuthConfig(config);
    expect(result).not.toBeNull();
    expect(result?.content).toBeUndefined();
  });

  describe('HTTPS validation', () => {
    it('should reject http endpoints', () => {
      const config = JSON.stringify({
        verify: {
          endpoint: 'http://example.com/api/verify',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      });

      const result = parseAuthConfig(config);
      expect(result).toBeNull();
    });

    it('should reject http endpoints in content config', () => {
      const config = JSON.stringify({
        verify: {
          endpoint: 'https://example.com/api/verify',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
        content: {
          endpoint: 'http://example.com/api/content',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      });

      const result = parseAuthConfig(config);
      expect(result).toBeNull();
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

    it('should reject URLs with other protocols', () => {
      const configs = ['ftp://example.com/verify', 'file:///etc/passwd', 'data:text/plain,hello'];

      for (const endpoint of configs) {
        const config = JSON.stringify({
          verify: {
            endpoint,
            method: 'GET',
            tokenHeader: 'Authorization',
            tokenPrefix: 'Bearer ',
          },
        });

        expect(parseAuthConfig(config)).toBeNull();
      }
    });

    it('should accept valid https endpoints', () => {
      const config = JSON.stringify({
        verify: {
          endpoint: 'https://example.com/api/verify',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      });

      const result = parseAuthConfig(config);
      expect(result).not.toBeNull();
      expect(result?.verify.endpoint).toBe('https://example.com/api/verify');
    });

    it('should accept https with port numbers', () => {
      const config = JSON.stringify({
        verify: {
          endpoint: 'https://example.com:8443/api/verify',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      });

      const result = parseAuthConfig(config);
      expect(result).not.toBeNull();
    });

    it('should accept https with query parameters', () => {
      const config = JSON.stringify({
        verify: {
          endpoint: 'https://example.com/api/verify?version=1',
          method: 'GET',
          tokenHeader: 'Authorization',
          tokenPrefix: 'Bearer ',
        },
      });

      const result = parseAuthConfig(config);
      expect(result).not.toBeNull();
    });
  });
});

describe('verifyLicense', () => {
  const mockAuthConfig: SkillAuthConfig = {
    verify: {
      endpoint: 'https://example.com/api/verify',
      method: 'GET',
      tokenHeader: 'Authorization',
      tokenPrefix: 'Bearer ',
    },
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return valid: true for successful verification', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ valid: true }),
    } as Response);

    const result = await verifyLicense(mockAuthConfig, 'sk-test-key');

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/api/verify',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer sk-test-key',
        },
      })
    );
  });

  it('should include expiresAt when returned by server', async () => {
    const expiresAt = '2025-12-31T23:59:59Z';
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ valid: true, expiresAt }),
    } as Response);

    const result = await verifyLicense(mockAuthConfig, 'sk-test-key');

    expect(result.valid).toBe(true);
    expect(result.expiresAt).toBe(expiresAt);
  });

  it('should return invalid for 401 status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as Response);

    const result = await verifyLicense(mockAuthConfig, 'invalid-key');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid or expired license key');
  });

  it('should return invalid for 403 status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as Response);

    const result = await verifyLicense(mockAuthConfig, 'forbidden-key');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid or expired license key');
  });

  it('should return rate limit error for 429 status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    const result = await verifyLicense(mockAuthConfig, 'test-key');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Too many attempts. Try again later.');
  });

  it('should return error for other non-ok statuses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const result = await verifyLicense(mockAuthConfig, 'test-key');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Verification failed with status 500');
  });

  it('should return invalid when server explicitly returns valid: false', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ valid: false, error: 'License expired' }),
    } as Response);

    const result = await verifyLicense(mockAuthConfig, 'expired-key');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('License expired');
  });

  it('should handle network errors after retries exhausted', async () => {
    // Network errors trigger retries - need to fail all 3 attempts (initial + 2 retries)
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await verifyLicense(mockAuthConfig, 'test-key');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Unable to reach verification server');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('should succeed after transient network failure with retry', async () => {
    // First attempt fails, second succeeds
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ valid: true }),
      } as Response);

    const result = await verifyLicense(mockAuthConfig, 'test-key');

    expect(result.valid).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should succeed after two transient network failures with retry', async () => {
    // First two attempts fail, third succeeds
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ valid: true }),
      } as Response);

    const result = await verifyLicense(mockAuthConfig, 'test-key');

    expect(result.valid).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('should not retry timeout errors', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValueOnce(abortError);

    const result = await verifyLicense(mockAuthConfig, 'test-key');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Verification request timed out');
    // Should not retry timeouts
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should not retry HTTP errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const result = await verifyLicense(mockAuthConfig, 'test-key');

    expect(result.valid).toBe(false);
    // HTTP errors are not retried
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should handle non-JSON response on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async (): Promise<unknown> => {
        throw new Error('Not JSON');
      },
    } as Response);

    const result = await verifyLicense(mockAuthConfig, 'test-key');

    // Should assume valid if 2xx but can't parse JSON
    expect(result.valid).toBe(true);
  });

  it('should use POST method when configured', async () => {
    const postConfig: SkillAuthConfig = {
      verify: {
        endpoint: 'https://example.com/api/verify',
        method: 'POST',
        tokenHeader: 'X-License-Key',
        tokenPrefix: '',
      },
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ valid: true }),
    } as Response);

    await verifyLicense(postConfig, 'sk-test-key');

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/api/verify',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'X-License-Key': 'sk-test-key',
          'Content-Type': 'application/json',
        },
      })
    );
  });
});

describe('fetchPrivateSkillContent', () => {
  const mockAuthConfigWithContent: SkillAuthConfig = {
    verify: {
      endpoint: 'https://example.com/api/verify',
      method: 'GET',
      tokenHeader: 'Authorization',
      tokenPrefix: 'Bearer ',
    },
    content: {
      endpoint: 'https://example.com/api/skill-content',
      method: 'GET',
      tokenHeader: 'Authorization',
      tokenPrefix: 'Bearer ',
    },
  };

  const mockAuthConfigWithoutContent: SkillAuthConfig = {
    verify: {
      endpoint: 'https://example.com/api/verify',
      method: 'GET',
      tokenHeader: 'Authorization',
      tokenPrefix: 'Bearer ',
    },
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return error when no content endpoint is configured', async () => {
    const result = await fetchPrivateSkillContent(mockAuthConfigWithoutContent, 'test-key');

    expect(result.success).toBe(false);
    expect(result.error).toBe('No content endpoint configured');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should fetch content successfully', async () => {
    const skillContent = '---\nname: test-skill\n---\n# Test Skill';
    const encoder = new TextEncoder();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => encoder.encode(skillContent).buffer,
    } as Response);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'sk-valid-key');

    expect(result.success).toBe(true);
    expect(result.content).toBe(skillContent);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/api/skill-content',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer sk-valid-key',
        },
      })
    );
  });

  it('should return error for 401 status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as Response);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'invalid-key');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid or expired license key');
  });

  it('should return error for 403 status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as Response);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'forbidden-key');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid or expired license key');
  });

  it('should return error for 429 status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'test-key');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Too many attempts. Try again later.');
  });

  it('should return error for empty content', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'test-key');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Content endpoint returned empty response');
  });

  it('should return error for whitespace-only content', async () => {
    const encoder = new TextEncoder();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => encoder.encode('   \n\t  ').buffer,
    } as Response);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'test-key');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Content endpoint returned empty response');
  });

  it('should handle network errors after retries exhausted', async () => {
    // Network errors trigger retries - fail all 3 attempts
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'test-key');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unable to reach content server');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('should succeed after transient network failure with retry', async () => {
    const skillContent = '# Skill after retry';
    const encoder = new TextEncoder();

    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => encoder.encode(skillContent).buffer,
      } as Response);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'test-key');

    expect(result.success).toBe(true);
    expect(result.content).toBe(skillContent);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should not retry timeout errors', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValueOnce(abortError);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'test-key');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Content fetch request timed out');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should not retry HTTP errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'test-key');

    expect(result.success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should use POST method when configured', async () => {
    const postConfig: SkillAuthConfig = {
      verify: {
        endpoint: 'https://example.com/api/verify',
        method: 'GET',
        tokenHeader: 'Authorization',
        tokenPrefix: 'Bearer ',
      },
      content: {
        endpoint: 'https://example.com/api/skill-content',
        method: 'POST',
        tokenHeader: 'X-License-Key',
        tokenPrefix: '',
      },
    };

    const encoder = new TextEncoder();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => encoder.encode('# Skill content').buffer,
    } as Response);

    await fetchPrivateSkillContent(postConfig, 'sk-test-key');

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/api/skill-content',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'X-License-Key': 'sk-test-key',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  it('should detect gzip tarball and return extractedPath', async () => {
    // Gzip magic bytes: 0x1f 0x8b followed by some data
    // This is a minimal gzip header - not a valid tarball but enough to test detection
    const gzipData = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => gzipData.buffer,
    } as Response);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'sk-valid-key');

    // Since we're using invalid tarball data, extraction will fail
    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to extract skill tarball');
  });

  it('should return plain text when data does not start with gzip magic bytes', async () => {
    // Data that doesn't start with 0x1f 0x8b
    const plainText = '# Not a tarball';
    const encoder = new TextEncoder();

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => encoder.encode(plainText).buffer,
    } as Response);

    const result = await fetchPrivateSkillContent(mockAuthConfigWithContent, 'sk-valid-key');

    expect(result.success).toBe(true);
    expect(result.content).toBe(plainText);
    expect(result.extractedPath).toBeUndefined();
  });
});
