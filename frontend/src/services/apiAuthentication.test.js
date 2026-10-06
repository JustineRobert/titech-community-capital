import {
  AUTH_ERROR_CATEGORY,
  classifyAuthenticationError,
  getAuthenticationErrorMessage,
} from './api.js';

describe('authentication failure classification', () => {
  it('keeps connection refusal outside authentication semantics', () => {
    const error = Object.assign(new Error('ERR_CONNECTION_REFUSED'), {
      code: 'ERR_NETWORK',
      response: undefined,
    });

    expect(classifyAuthenticationError(error)).toBe(
      AUTH_ERROR_CATEGORY.API_UNAVAILABLE,
    );
    expect(getAuthenticationErrorMessage(error)).toMatch(/service.*unavailable/i);
  });

  it('classifies timeout separately from connection refusal', () => {
    const error = Object.assign(new Error('timeout of 2500ms exceeded'), {
      code: 'ECONNABORTED',
    });

    expect(classifyAuthenticationError(error)).toBe(
      AUTH_ERROR_CATEGORY.API_TIMEOUT,
    );
  });

  it('preserves authoritative authentication status semantics', () => {
    expect(classifyAuthenticationError({ response: { status: 401 } })).toBe(
      AUTH_ERROR_CATEGORY.INVALID_CREDENTIALS,
    );
    expect(classifyAuthenticationError({ response: { status: 403 } })).toBe(
      AUTH_ERROR_CATEGORY.FORBIDDEN,
    );
    expect(classifyAuthenticationError({ response: { status: 423 } })).toBe(
      AUTH_ERROR_CATEGORY.ACCOUNT_LOCKED,
    );
    expect(classifyAuthenticationError({ response: { status: 429 } })).toBe(
      AUTH_ERROR_CATEGORY.RATE_LIMITED,
    );
    expect(classifyAuthenticationError({ response: { status: 503 } })).toBe(
      AUTH_ERROR_CATEGORY.NOT_READY,
    );
  });
  it('recognizes explicit backend authentication outcome codes', () => {
    expect(
      classifyAuthenticationError({
        response: { status: 403, data: { code: 'ACCOUNT_DISABLED' } },
      }),
    ).toBe(AUTH_ERROR_CATEGORY.ACCOUNT_DISABLED);

    expect(
      classifyAuthenticationError({
        response: { status: 401, data: { code: 'MFA_REQUIRED' } },
      }),
    ).toBe(AUTH_ERROR_CATEGORY.MFA_REQUIRED);

    expect(
      classifyAuthenticationError({
        response: { status: 409, data: { code: 'TENANT_UNAVAILABLE' } },
      }),
    ).toBe(AUTH_ERROR_CATEGORY.TENANT_UNAVAILABLE);
  });

});
