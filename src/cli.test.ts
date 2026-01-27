import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runCliOutput, stripLogo } from './test-utils.js';

describe('skills CLI', () => {
  describe('--help', () => {
    it('should display help message', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Usage: skills <command> [options]');
      expect(output).toContain('Commands:');
      expect(output).toContain('init [name]');
      expect(output).toContain('install');
      expect(output).toContain('add <package>');
      expect(output).toContain('check');
      expect(output).toContain('update');
      expect(output).toContain('generate-lock');
      expect(output).toContain('Add/Install Options:');
      expect(output).toContain('-g, --global');
      expect(output).toContain('-a, --agent');
      expect(output).toContain('-s, --skill');
      expect(output).toContain('-l, --list');
      expect(output).toContain('-y, --yes');
      expect(output).toContain('--all');
      expect(output).toContain('--sync');
      expect(output).toContain('.skills File:');
    });

    it('should show same output for -h alias', () => {
      const helpOutput = runCliOutput(['--help']);
      const hOutput = runCliOutput(['-h']);
      expect(hOutput).toBe(helpOutput);
    });
  });

  describe('--version', () => {
    it('should display version number', () => {
      const output = runCliOutput(['--version']);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should match package.json version', () => {
      const output = runCliOutput(['--version']);
      const pkg = JSON.parse(
        readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8')
      );
      expect(output.trim()).toBe(pkg.version);
    });
  });

  describe('no arguments', () => {
    it('should display banner', () => {
      const output = stripLogo(runCliOutput([]));
      expect(output).toContain('The open agent skills ecosystem');
      expect(output).toContain('npx skills add');
      expect(output).toContain('npx skills check');
      expect(output).toContain('npx skills update');
      expect(output).toContain('npx skills init');
      expect(output).toContain('skills.sh');
    });
  });

  describe('unknown command', () => {
    it('should show error for unknown command', () => {
      const output = runCliOutput(['unknown-command']);
      expect(output).toMatchInlineSnapshot(`
        "Unknown command: unknown-command
        Run skills --help for usage.
        "
      `);
    });
  });
});
