import { describe, it, expect } from 'vitest';
import {
  INSTANCE_TIMEOUT_MS,
  DEFAULT_CLI_TIMEOUT_MS,
  MAX_RETRIES,
  MAX_RATE_LIMIT_RETRIES,
  DEFAULT_BASE_DELAY_MS,
  MAX_BACKOFF_DELAY_MS,
  RENDER_INTERVAL_MS,
  SPINNER_INTERVAL_MS,
} from '../src/config.js';

describe('config', () => {
  it('exports instance timeout as 30 minutes', () => {
    expect(INSTANCE_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it('exports default CLI timeout as 5 minutes', () => {
    expect(DEFAULT_CLI_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it('exports max retries as 3', () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it('exports max rate-limit retries as 10', () => {
    expect(MAX_RATE_LIMIT_RETRIES).toBe(10);
  });

  it('exports default base delay as 10 seconds', () => {
    expect(DEFAULT_BASE_DELAY_MS).toBe(10_000);
  });

  it('exports max backoff delay as 5 minutes', () => {
    expect(MAX_BACKOFF_DELAY_MS).toBe(5 * 60 * 1000);
  });

  it('exports render interval as 1 second', () => {
    expect(RENDER_INTERVAL_MS).toBe(1000);
  });

  it('exports spinner interval matching render interval', () => {
    expect(SPINNER_INTERVAL_MS).toBe(RENDER_INTERVAL_MS);
  });

  it('all values are positive numbers', () => {
    const allValues = [
      INSTANCE_TIMEOUT_MS,
      DEFAULT_CLI_TIMEOUT_MS,
      MAX_RETRIES,
      MAX_RATE_LIMIT_RETRIES,
      DEFAULT_BASE_DELAY_MS,
      MAX_BACKOFF_DELAY_MS,
      RENDER_INTERVAL_MS,
      SPINNER_INTERVAL_MS,
    ];
    for (const value of allValues) {
      expect(value).toBeGreaterThan(0);
      expect(typeof value).toBe('number');
    }
  });
});
