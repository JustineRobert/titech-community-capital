# Registration / Create Account / Sign Up

## Endpoint

`POST /api/auth/register`

## Required information

The existing contract accepts `name`, `fullName`, or `firstName` + `lastName`, together with a valid email and password. Phone information remains optional where supported by the existing validator.

## Password policy

The authentication registration boundary now aligns with the enterprise minimum of 12 characters and requires lowercase, uppercase, and numeric characters. The password is additionally protected by the User model's bcrypt hashing lifecycle.

## Security

- Email is normalized.
- Duplicate normalized emails are rejected.
- Passwords are never returned.
- Password hashes are never returned.
- Tenant context is validated.
- Existing role/account initialization remains in place.
- Rate limiting is enforced by the existing route.