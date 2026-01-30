/**
 * Unit tests for filterSkills function in skills.ts
 *
 * These tests verify the skill matching logic. Multi-word skill names
 * must be quoted on the command line (e.g., --skill "Convex Best Practices").
 */

import { describe, it, expect } from 'vitest';
import { filterSkills } from '../src/skills.ts';
import type { Skill } from '../src/types.ts';

// Mock skill factory
function makeSkill(name: string, path: string = '/tmp/skill'): Skill {
  return { name, description: 'desc', path };
}

const skills: Skill[] = [
  makeSkill('convex-best-practices'),
  makeSkill('Convex Best Practices'),
  makeSkill('simple-skill'),
  makeSkill('foo'),
  makeSkill('bar'),
];

describe('filterSkills', () => {
  describe('direct matching', () => {
    it('matches exact name', () => {
      const result = filterSkills(skills, ['foo']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('foo');
    });

    it('matches case insensitive', () => {
      const result = filterSkills(skills, ['FOO']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('foo');
    });

    it('matches kebab-case skill name', () => {
      const result = filterSkills(skills, ['convex-best-practices']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('convex-best-practices');
    });

    it('matches multiple skills', () => {
      const result = filterSkills(skills, ['foo', 'bar']);
      expect(result.length).toBe(2);
      const names = result.map((s) => s.name).sort();
      expect(names).toEqual(['bar', 'foo']);
    });
  });

  describe('quoted multi-word names', () => {
    it('matches quoted multi-word name', () => {
      // Simulates: --skill "Convex Best Practices"
      const result = filterSkills(skills, ['Convex Best Practices']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Convex Best Practices');
    });

    it('matches quoted multi-word name case insensitive', () => {
      const result = filterSkills(skills, ['convex best practices']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Convex Best Practices');
    });
  });

  describe('unquoted multi-word names (should not match)', () => {
    it('does not match unquoted multi-word args', () => {
      // Simulates: --skill Convex Best Practices (unquoted - shell splits into 3 args)
      // This should NOT match - users must quote multi-word names
      const result = filterSkills(skills, ['Convex', 'Best', 'Practices']);
      expect(result.length).toBe(0);
    });

    it('does not match partial words', () => {
      const result = filterSkills(skills, ['Convex', 'Best']);
      expect(result.length).toBe(0);
    });
  });

  describe('no matches', () => {
    it('returns empty array when no matches', () => {
      const result = filterSkills(skills, ['nonexistent']);
      expect(result.length).toBe(0);
    });

    it('returns empty array for empty input', () => {
      const result = filterSkills(skills, []);
      expect(result.length).toBe(0);
    });
  });
});
