/**
 * Tests for XDG config path handling (cross-platform).
 *
 * These tests verify that agents using XDG Base Directory specification
 * (OpenCode, Amp, Goose) use ~/.config paths consistently across all platforms,
 * NOT platform-specific paths like ~/Library/Preferences on macOS.
 *
 * This is critical because OpenCode uses xdg-basedir which always returns
 * ~/.config (or $XDG_CONFIG_HOME if set), regardless of platform.
 * The skills CLI must match this behavior to install skills in the correct location.
 *
 * See: https://github.com/vercel-labs/skills/pull/66
 * See: https://github.com/vercel-labs/skills/issues/63
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { agents } from '../src/agents.ts';

describe('XDG config paths', () => {
  const home = homedir();

  describe('OpenCode', () => {
    it('uses ~/.config/opencode/skills for global skills (not ~/Library/Preferences)', () => {
      const expected = join(home, '.config', 'opencode', 'skills');
      expect(agents.opencode.globalSkillsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths like ~/Library/Preferences', () => {
      expect(agents.opencode.globalSkillsDir).not.toContain('Library');
      expect(agents.opencode.globalSkillsDir).not.toContain('Preferences');
      expect(agents.opencode.globalSkillsDir).not.toContain('AppData');
    });
  });

  describe('Amp', () => {
    it('uses ~/.config/agents/skills for global skills', () => {
      const expected = join(home, '.config', 'agents', 'skills');
      expect(agents.amp.globalSkillsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths', () => {
      expect(agents.amp.globalSkillsDir).not.toContain('Library');
      expect(agents.amp.globalSkillsDir).not.toContain('Preferences');
      expect(agents.amp.globalSkillsDir).not.toContain('AppData');
    });
  });

  describe('Goose', () => {
    it('uses ~/.config/goose/skills for global skills', () => {
      const expected = join(home, '.config', 'goose', 'skills');
      expect(agents.goose.globalSkillsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths', () => {
      expect(agents.goose.globalSkillsDir).not.toContain('Library');
      expect(agents.goose.globalSkillsDir).not.toContain('Preferences');
      expect(agents.goose.globalSkillsDir).not.toContain('AppData');
    });
  });

  describe('non-XDG agents', () => {
    it('cursor uses ~/.cursor/skills (home-based, not XDG)', () => {
      const expected = join(home, '.cursor', 'skills');
      expect(agents.cursor.globalSkillsDir).toBe(expected);
    });

    it('cline uses ~/.cline/skills (home-based, not XDG)', () => {
      const expected = join(home, '.cline', 'skills');
      expect(agents.cline.globalSkillsDir).toBe(expected);
    });
  });
});
