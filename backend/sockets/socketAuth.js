'use strict';

/**
 * ============================================================================
 * SOCKET AUTHENTICATION MIDDLEWARE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Secures Socket.IO connections using JWT authentication.
 *
 * RESPONSIBILITIES
 * ----------------------------------------------------------------------------
 * ✅ Validate JWT token from handshake
 * ✅ Load authenticated user from database
 * ✅ Attach user context to socket
 * ✅ Enforce session integrity
 * ✅ Prevent unauthorized realtime access
 *
 * SECURITY NOTES
 * ----------------------------------------------------------------------------
 * - This is ONLY authentication (not authorization)
 * - Authorization is handled in event handlers/services
 *
 * ============================================================================
 */

const jwt =
  require('jsonwebtoken');

const User =
  require('../models/User');

/*
|--------------------------------------------------------------------------
| Socket Authentication Middleware
|--------------------------------------------------------------------------
*/

module.exports = async function socketAuth(
  socket,
  next
) {
  try {
    /*
    |--------------------------------------------------------------------------
    | Extract Token
    |--------------------------------------------------------------------------
    */

    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token;

    if (!token) {
      return next(
        new Error(
          'Socket authentication failed: token missing'
        )
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Verify JWT
    |--------------------------------------------------------------------------
    */

    let decoded;

    try {
      decoded =
        jwt.verify(
          token,
          process.env.JWT_SECRET
        );
    } catch (err) {
      return next(
        new Error(
          'Socket authentication failed: invalid token'
        )
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Load User
    |--------------------------------------------------------------------------
    */

    const user =
      await User.findById(
        decoded.sub ||
          decoded.id ||
          decoded._id
      ).select(
        '_id role email firstName lastName status'
      );

    if (!user) {
      return next(
        new Error(
          'Socket authentication failed: user not found'
        )
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Account Status Check
    |--------------------------------------------------------------------------
    */

    if (
      user.status &&
      user.status !== 'ACTIVE'
    ) {
      return next(
        new Error(
          'Socket authentication failed: account inactive'
        )
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Attach User Context
    |--------------------------------------------------------------------------
    */

    socket.user = {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
      name: `${user.firstName || ''} ${
        user.lastName || ''
      }`.trim(),
    };

    /*
    |--------------------------------------------------------------------------
    | Session Metadata
    |--------------------------------------------------------------------------
    */

    socket.auth = {
      authenticatedAt:
        new Date(),
      ip:
        socket.handshake.address,
    };

    return next();
  } catch (err) {
    return next(
      new Error(
        'Socket authentication failed'
      )
    );
  }
};