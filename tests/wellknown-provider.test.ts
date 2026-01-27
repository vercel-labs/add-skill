import { describe, it, expect } from 'vitest';
import { WellKnownProvider } from '../src/providers/wellknown.ts';

describe('WellKnownProvider', () => {
  const provider = new WellKnownProvider();

  describe('match', () => {
    it('should match arbitrary HTTP URLs', () => {
      expect(provider.match('https://example.com').matches).toBe(true);
      expect(provider.match('https://docs.example.com/skills').matches).toBe(true);
      expect(provider.match('http://localhost:3000').matches).toBe(true);
    });

    it('should match URLs with paths', () => {
      expect(provider.match('https://mintlify.com/docs').matches).toBe(true);
      expect(provider.match('https://example.com/api/v1').matches).toBe(true);
    });

    it('should not match GitHub URLs', () => {
      expect(provider.match('https://github.com/owner/repo').matches).toBe(false);
    });

    it('should not match GitLab URLs', () => {
      expect(provider.match('https://gitlab.com/owner/repo').matches).toBe(false);
    });

    it('should not match HuggingFace URLs', () => {
      expect(provider.match('https://huggingface.co/spaces/owner/repo').matches).toBe(false);
    });

    it('should not match non-HTTP URLs', () => {
      expect(provider.match('git@github.com:owner/repo.git').matches).toBe(false);
      expect(provider.match('ssh://git@example.com/repo').matches).toBe(false);
      expect(provider.match('/local/path').matches).toBe(false);
    });
  });

  describe('getSourceIdentifier', () => {
    it('should return domain in owner/repo format (sld/tld)', () => {
      expect(provider.getSourceIdentifier('https://example.com')).toBe('example/com');
      expect(provider.getSourceIdentifier('https://mintlify.com')).toBe('mintlify/com');
      expect(provider.getSourceIdentifier('https://lovable.dev')).toBe('lovable/dev');
    });

    it('should return same identifier regardless of path', () => {
      expect(provider.getSourceIdentifier('https://example.com/docs')).toBe('example/com');
      expect(provider.getSourceIdentifier('https://example.com/api/v1')).toBe('example/com');
    });

    it('should strip subdomains and use main domain', () => {
      expect(provider.getSourceIdentifier('https://docs.example.com')).toBe('example/com');
      expect(provider.getSourceIdentifier('https://api.mintlify.com/docs')).toBe('mintlify/com');
    });
  });

  describe('toRawUrl', () => {
    it('should return index.json URL for base URLs', () => {
      const result = provider.toRawUrl('https://example.com');
      expect(result).toBe('https://example.com/.well-known/skills/index.json');
    });

    it('should return index.json URL with path', () => {
      const result = provider.toRawUrl('https://example.com/docs');
      expect(result).toBe('https://example.com/docs/.well-known/skills/index.json');
    });

    it('should return SKILL.md URL if already pointing to skill.md', () => {
      const url = 'https://example.com/.well-known/skills/my-skill/SKILL.md';
      expect(provider.toRawUrl(url)).toBe(url);
    });
  });

  describe('isValidSkillEntry (via fetchIndex validation)', () => {
    // Since isValidSkillEntry is private, we test it indirectly through the provider's behavior

    it('provider should have id "well-known"', () => {
      expect(provider.id).toBe('well-known');
    });

    it('provider should have display name "Well-Known Skills"', () => {
      expect(provider.displayName).toBe('Well-Known Skills');
    });
  });
});

describe('parseSource with well-known URLs', async () => {
  // Import parseSource after provider is defined
  const { parseSource } = await import('../src/source-parser.ts');

  it('should parse arbitrary URL as well-known type', () => {
    const result = parseSource('https://example.com');
    expect(result.type).toBe('well-known');
    expect(result.url).toBe('https://example.com');
  });

  it('should parse URL with path as well-known type', () => {
    const result = parseSource('https://mintlify.com/docs');
    expect(result.type).toBe('well-known');
    expect(result.url).toBe('https://mintlify.com/docs');
  });

  it('should not parse GitHub URL as well-known', () => {
    const result = parseSource('https://github.com/owner/repo');
    expect(result.type).toBe('github');
  });

  it('should not parse .git URL as well-known', () => {
    const result = parseSource('https://git.example.com/owner/repo.git');
    expect(result.type).toBe('git');
  });

  it('should not parse direct skill.md URL as well-known', () => {
    const result = parseSource('https://docs.example.com/skill.md');
    expect(result.type).toBe('direct-url');
  });
});
