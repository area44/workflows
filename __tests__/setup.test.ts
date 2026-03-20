import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import * as core from '@actions/core';
import { detectNodeVersion, detectPackageManager } from '../src/setup';

vi.mock('fs');
vi.mock('@actions/core');

describe('setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectNodeVersion', () => {
    it('should return version from .nvmrc if it exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === '.nvmrc');
      vi.mocked(fs.readFileSync).mockReturnValue('20');

      expect(detectNodeVersion()).toBe('20');
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Found .nvmrc: 20'));
    });

    it('should return version from package.json engines if .nvmrc does not exist', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === 'package.json');
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ engines: { node: '>=18' } }));

      expect(detectNodeVersion()).toBe('>=18');
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Found Node.js version in package.json engines: >=18'));
    });

    it('should return lts/* if no version is found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(detectNodeVersion()).toBe('lts/*');
    });
  });

  describe('detectPackageManager', () => {
    it('should detect pnpm-lock.yaml', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === 'pnpm-lock.yaml');
      expect(detectPackageManager().name).toBe('pnpm');
    });

    it('should detect yarn.lock', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === 'yarn.lock');
      expect(detectPackageManager().name).toBe('yarn');
    });

    it('should detect package-lock.json', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === 'package-lock.json');
      expect(detectPackageManager().name).toBe('npm');
    });

    it('should detect bun.lockb', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === 'bun.lockb');
      expect(detectPackageManager().name).toBe('bun');
    });

    it('should detect packageManager in package.json', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === 'package.json');
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ packageManager: 'pnpm@9.0.0' }));

      const pm = detectPackageManager();
      expect(pm.name).toBe('pnpm');
      expect(pm.version).toBe('9.0.0');
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Found packageManager in package.json: pnpm@9.0.0'));
    });
  });
});
