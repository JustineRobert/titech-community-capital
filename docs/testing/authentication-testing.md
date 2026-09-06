# Authentication Testing

## Required lifecycle test

```text
Register
  -> Login
  -> authenticated request
  -> Refresh
  -> authenticated request
  -> Logout
  -> refresh must fail
  -> Login again
  -> Forgot password
  -> Reset password
  -> old password must fail
  -> new password must succeed
  -> reset token reuse must fail
```

## Test categories

- route contract tests
- controller unit tests
- service unit tests
- MongoDB integration tests
- frontend AuthProvider tests
- login/register UI tests
- password-reset UI tests
- token replay tests
- account-enumeration tests
- tenant-isolation tests
- rate-limit tests

## Commands

Run the commands exposed by the repository rather than assuming scripts exist:

```bash
cd backend
npm test
npm run test:integration
npm run test:unit
npm run lint
npm run format:check

cd ../frontend
npm test
npm run lint
npm run build
```

A test may only be reported as passed when it was actually executed successfully.