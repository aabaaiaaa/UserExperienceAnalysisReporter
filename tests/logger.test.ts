import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setVerbose, isVerbose, debug } from '../src/logger.js';

describe('logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setVerbose(false);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    setVerbose(false);
  });

  describe('setVerbose / isVerbose', () => {
    it('defaults to false', () => {
      expect(isVerbose()).toBe(false);
    });

    it('can be enabled', () => {
      setVerbose(true);
      expect(isVerbose()).toBe(true);
    });

    it('can be toggled back off', () => {
      setVerbose(true);
      setVerbose(false);
      expect(isVerbose()).toBe(false);
    });
  });

  describe('debug', () => {
    it('does not write when verbose is off', () => {
      debug('should not appear');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('writes to stderr when verbose is on', () => {
      setVerbose(true);
      debug('hello world');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[DEBUG');
      expect(output).toContain('hello world');
      expect(output).toMatch(/\n$/);
    });

    it('includes a timestamp', () => {
      setVerbose(true);
      debug('timestamp check');
      const output = stderrSpy.mock.calls[0][0] as string;
      // ISO timestamp pattern: YYYY-MM-DDTHH:MM:SS
      expect(output).toMatch(/\[DEBUG \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('appends extra arguments', () => {
      setVerbose(true);
      debug('process exited', 'pid=123', 'code=0');
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('process exited');
      expect(output).toContain('pid=123');
      expect(output).toContain('code=0');
    });

    it('handles zero extra arguments', () => {
      setVerbose(true);
      debug('no extras');
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('no extras');
      // Should not have trailing space before newline
      expect(output).toMatch(/no extras\n$/);
    });

    it('converts non-string arguments via String()', () => {
      setVerbose(true);
      debug('mixed args', 42, true, null);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('42');
      expect(output).toContain('true');
      expect(output).toContain('null');
    });
  });
});
