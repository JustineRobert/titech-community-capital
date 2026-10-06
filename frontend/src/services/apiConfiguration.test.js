import {
  DEFAULT_DEV_API_ORIGIN,
  getApiConfigurationDiagnostics,
  isRelativeApiProxy,
  normalizeConfiguredApiBaseUrl,
  resolveApiBaseUrl,
} from './apiConfiguration.js';

describe('API origin configuration contract', () => {
  it('normalizes an explicit absolute backend origin', () => {
    expect(normalizeConfiguredApiBaseUrl('https://api.example.com/')).toBe(
      'https://api.example.com',
    );
  });

  it('normalizes explicit API-path configuration to same-origin mode', () => {
    expect(normalizeConfiguredApiBaseUrl('/api/v1')).toBe('');
    expect(normalizeConfiguredApiBaseUrl('/api')).toBe('');
  });

  it('recognizes relative proxy configuration without treating it as a backend origin', () => {
    expect(isRelativeApiProxy('/api/v1')).toBe(true);
    expect(isRelativeApiProxy('//api.example.com')).toBe(false);
  });

  it('uses a development fallback only in non-production mode', () => {
    expect(resolveApiBaseUrl({}, { production: false })).toBe(
      DEFAULT_DEV_API_ORIGIN,
    );
  });

  it('fails closed when production API configuration is absent', () => {
    expect(() => resolveApiBaseUrl({}, { production: true })).toThrowError(
      /requires VITE_API_URL/i,
    );
    expect(() => resolveApiBaseUrl({}, { production: true })).toThrowError(
      expect.objectContaining({ code: 'TITECH_API_ORIGIN_MISSING' }),
    );
  });

  it('records whether production is intentionally using an explicit same-origin proxy', () => {
    expect(getApiConfigurationDiagnostics({ VITE_API_URL: '/api/v1' })).toMatchObject({
      configured: true,
      sameOriginProxy: true,
      source: 'VITE_API_URL',
      normalizedBaseUrl: '',
    });
  });
});
