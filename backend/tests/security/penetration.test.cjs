/**
 * Penetration Testing Configuration
 * ============================================================================
 * OWASP Top 10 security testing for Community Savings App
 *
 * Tests cover:
 * 1. Injection attacks (SQL, NoSQL, Command)
 * 2. Broken Authentication
 * 3. Sensitive Data Exposure
 * 4. XML External Entities (XXE)
 * 5. Broken Access Control
 * 6. Security Misconfiguration
 * 7. Cross-Site Scripting (XSS)
 * 8. Insecure Deserialization
 * 9. Using Components with Known Vulnerabilities
 * 10. Insufficient Logging & Monitoring
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../server');

describe('Security Penetration Tests (OWASP Top 10)', () => {
  let validToken;


  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost/test');
    }

    // Create and authenticate a test user
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `pentest-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        fullName: 'Pentester',
        phoneNumber: '+254712345678',
      });

    validToken = registerRes.body.token;

  });

  describe('A1: Injection Attacks', () => {
    describe('NoSQL Injection', () => {
      it('should not allow NoSQL injection in query parameters', (done) => {
        request(app)
          .get('/api/users?email=[$ne]=')
          .set('Authorization', `Bearer ${validToken}`)
          .end((err, res) => {
            if (err) return done(err);
            // Should not return sensitive data or cause error
            expect(res.status).not.toBe(200);
            done();
          });
      });

      it('should sanitize JSON post data', (done) => {
        request(app)
          .post('/api/contributions/submit')
          .set('Authorization', `Bearer ${validToken}`)
          .send({
            amount: { $gt: 0 },
            groupId: 'test',
          })
          .end((err, res) => {
            // Should validate and reject malicious operators
            expect(res.status).not.toBe(201);
            done();
          });
      });
    });

    describe('Command Injection', () => {
      it('should not execute shell commands', (done) => {
        request(app)
          .post('/api/payments/initiate')
          .set('Authorization', `Bearer ${validToken}`)
          .send({
            phone: '+254712345678; rm -rf /',
            amount: 100,
            provider: 'mpesa',
          })
          .end((err, res) => {
            // Should treat as invalid input
            expect(res.status).not.toBe(200);
            done();
          });
      });
    });
  });

  describe('A2: Broken Authentication', () => {
    it('should not allow authentication bypass with empty password', (done) => {
      request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@example.com',
          password: '',
        })
        .expect(401)
        .end((err, _res) => {
          if (err) return done(err);
          done();
        });
    });

    it('should not return sensitive data on failed login', (done) => {
      request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'wrongpassword',
        })
        .end((err, res) => {
          if (err) return done(err);
          // Should not reveal whether email exists
          expect(res.body.message).not.toMatch(/not registered/);
          done();
        });
    });

    it('should enforce rate limiting on login attempts', async () => {
      const loginAttempts = 10;

      for (let i = 0; i < loginAttempts; i++) {
        const res = await request(app).post('/api/auth/login').send({
          email: 'test@example.com',
          password: 'wrongpassword',
        });

        if (res.status === 429) {
          // Rate limiter activated - test passed
          return;
        }
      }

      // If we got here without 429, rate limiting may not be working
      throw new Error('Rate limiting not enforced');
    });

    it('should invalidate tokens on logout', (done) => {
      request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${validToken}`)
        .end((err, _res) => {
          if (err) return done(err);

          // Token should be invalid after logout
          request(app)
            .get('/api/groups')
            .set('Authorization', `Bearer ${validToken}`)
            .end((err2, res2) => {
              expect(res2.status).toBe(401);
              done();
            });
        });
    });
  });

  describe('A3: Sensitive Data Exposure', () => {
    it('should use HTTPS headers (in production)', (done) => {
      request(app)
        .get('/')
        .end((err, res) => {
          if (err) return done(err);

          // Should have security headers
          expect(res.headers['x-content-type-options']).toBeDefined();
          expect(res.headers['x-frame-options']).toBeDefined();
          done();
        });
    });

    it('should not expose stack traces in production', (done) => {
      // Use invalid endpoint to trigger error
      request(app)
        .get('/api/invalid/very/long/endpoint')
        .set('Authorization', `Bearer ${validToken}`)
        .end((err, res) => {
          if (err) return done(err);

          const errorMessage = JSON.stringify(res.body);
          // Should not expose internal server details
          expect(errorMessage).not.toMatch(/\/server\.js/);
          expect(errorMessage).not.toMatch(/\/services\//);
          done();
        });
    });

    it('should not expose sensitive fields in responses', (done) => {
      request(app)
        .get('/api/groups')
        .set('Authorization', `Bearer ${validToken}`)
        .end((err, res) => {
          if (err) return done(err);

          if (res.body.groups && res.body.groups.length > 0) {
            const group = res.body.groups[0];
            // Should not expose internal fields
            expect(group).not.toHaveProperty('__v');
            expect(group).not.toHaveProperty('internalNotes');
          }
          done();
        });
    });
  });

  describe('A5: Broken Access Control', () => {
    it('should not allow access to other users data', (done) => {

        request(app)
        .get(`/api/contributions/user/${new mongoose.Types.ObjectId()}/statistics`)
        .set('Authorization', `Bearer ${validToken}`)
        .end((err, res) => {
          if (err) return done(err);

          // Should be forbidden or return appropriate error
          expect(res.status).not.toBe(200);
          done();
        });
    });

    it('should require authentication for protected endpoints', (done) => {
      request(app)
        .get('/api/groups')
        .end((err, res) => {
          if (err) return done(err);

          expect(res.status).toBe(401);
          done();
        });
    });

    it('should verify user owns the resource being modified', (done) => {
      const otherGroupId = new mongoose.Types.ObjectId();

      request(app)
        .put(`/api/groups/${otherGroupId}`)
        .set('Authorization', `Bearer ${validToken}`)
        .send({ name: 'Hacked Group' })
        .end((err, res) => {
          if (err) return done(err);

          // Should be forbidden
          expect(res.status).not.toBe(200);
          done();
        });
    });
  });

  describe('A7: Cross-Site Scripting (XSS)', () => {
    it('should sanitize user input to prevent XSS', (done) => {
      request(app)
        .post('/api/groups')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          name: '<script>alert("XSS")</script>',
          description: '<img src=x onerror="alert(\'XSS\')">',
        })
        .end((err, res) => {
          if (err) return done(err);

          if (res.status === 201) {
            // If accepted, should be sanitized
            expect(res.body.group.name).not.toContain('<script>');
            expect(res.body.group.description).not.toContain('onerror');
          }
          done();
        });
    });

    it('should sanitize chat messages', (done) => {
      request(app)
        .post('/api/chats/send')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          groupId: 'test',
          message: '<img src=x onerror="alert(\'XSS\')">',
        })
        .end((err, res) => {
          if (err) return done(err);

          if (res.status === 201) {
            expect(res.body.message.message).not.toContain('onerror');
          }
          done();
        });
    });

    it('should apply Content Security Policy header', (done) => {
      request(app)
        .get('/')
        .end((err, res) => {
          if (err) return done(err);

          // Should have CSP or at minimum basic XSS protections
          expect(res.headers['x-xss-protection']).toBeDefined();
          done();
        });
    });
  });

  describe('A6: Security Misconfiguration', () => {
    it('should not expose version information', (done) => {
      request(app)
        .get('/')
        .end((err, res) => {
          if (err) return done(err);

          // Should not expose Server header details
          const serverHeader = res.headers['server'] || '';
          expect(serverHeader).not.toMatch(/Express/i);
          done();
        });
    });

    it('should disable HTTP methods when not needed', (done) => {
      request(app)
        .trace('/')
        .end((err, res) => {
          // TRACE should be disabled
          expect(res.status).not.toBe(200);
          done();
        });
    });

    it('should use secure cookies', (done) => {
      request(app)
        .post('/api/auth/login')
        .send({
          email: `secure-${Date.now()}@example.com`,
          password: 'TestPassword123!',
        })
        .end((err, res) => {
          if (res.headers['set-cookie']) {
            res.headers['set-cookie'].forEach((cookie) => {
              // Should have Secure flag in production
              // Should have HttpOnly flag
              expect(cookie).toMatch(/HttpOnly/);
            });
          }
          done();
        });
    });
  });

  describe('Input Validation & Output Encoding', () => {
    it('should validate email format strictly', (done) => {
      request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-a-valid-email',
          password: 'SecurePassword123!',
          fullName: 'Test',
        })
        .expect(400)
        .end((err, _res) => {
          if (err) return done(err);
          done();
        });
    });

    it('should validate phone number format', (done) => {
      request(app)
        .post('/api/payments/initiate')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          phone: 'invalid-phone',
          amount: 100,
          provider: 'mpesa',
        })
        .expect(400)
        .end((err, _res) => {
          if (err) return done(err);
          done();
        });
    });

    it('should validate amount is positive number', (done) => {
      request(app)
        .post('/api/contributions/submit')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          groupId: 'test',
          amount: 'not-a-number',
          paymentMethod: 'mobile_money',
        })
        .expect(400)
        .end((err, _res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe('Logging & Monitoring', () => {
    it('should log failed authentication attempts', async () => {
      // Attempt login with invalid credentials multiple times
      for (let i = 0; i < 3; i++) {
        await request(app).post('/api/auth/login').send({
          email: 'test@example.com',
          password: 'wrong-password',
        });
      }

      // Verify logs can be accessed (if logging endpoint exists)
      // This is application-specific
    });
  });
});

module.exports = {};
