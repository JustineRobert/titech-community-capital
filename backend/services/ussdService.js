// ============================================================================
// TITech Community Capital
// Enterprise USSD Service
// File: backend/services/ussdService.js
// Production Grade
// ============================================================================

"use strict";

const crypto = require("crypto");
const EventEmitter = require("events");

const logger = require("../utils/logger");
const metricsService = require("./metricsService");
const ussdSessionService = require("./ussdSessionService");

let memberService;
let savingsService;
let loanService;
let mobileMoneyService;
let notificationService;

try {
  memberService = require("./memberService");
} catch (_) {}

try {
  savingsService = require("./savingsService");
} catch (_) {}

try {
  loanService = require("./loanService");
} catch (_) {}

try {
  mobileMoneyService =
    require("./mobileMoneySettlementService");
} catch (_) {}

try {
  notificationService =
    require("./notificationService");
} catch (_) {}

const SESSION_TTL =
  Number(
    process.env.USSD_SESSION_TTL ||
      300
  );

const MENU_SEPARATOR = "*";

class USSDService extends EventEmitter {
  constructor() {
    super();

    this.handlers =
      new Map();

    this.registerDefaultMenus();
  }

  // ===========================================================================
  // Menu Registration
  // ===========================================================================

  registerMenu(
    key,
    handler
  ) {
    this.handlers.set(
      key,
      handler
    );

    logger.info(
      "USSD menu registered",
      {
        menu: key,
      }
    );
  }

  unregisterMenu(key) {
    this.handlers.delete(key);
  }

  registerDefaultMenus() {
    this.registerMenu(
      "",
      this.mainMenu.bind(
        this
      )
    );

    this.registerMenu(
      "1",
      this.balanceMenu.bind(
        this
      )
    );

    this.registerMenu(
      "2",
      this.savingsMenu.bind(
        this
      )
    );

    this.registerMenu(
      "3",
      this.loanMenu.bind(
        this
      )
    );

    this.registerMenu(
      "4",
      this.profileMenu.bind(
        this
      )
    );
  }

  // ===========================================================================
  // Session Processing
  // ===========================================================================

  async process({
    tenant,
    sessionId,
    phoneNumber,
    serviceCode,
    text = "",
    correlationId,
    requestId,
  }) {
    const started =
      Date.now();

    const menu =
      text.trim();

    const requestHash =
      crypto
        .createHash(
          "sha256"
        )
        .update(
          `${tenant.id}:${sessionId}:${text}`
        )
        .digest("hex");

    try {
      metricsService.increment(
        "ussd.service.requests"
      );

      await this.ensureSession({
        sessionId,
        tenantId:
          tenant.id,
        phoneNumber,
      });

      const handler =
        this.handlers.get(
          menu
        ) ||
        this.routeDynamic(
          menu
        );

      let response;

      if (handler) {
        response =
          await handler({
            tenant,
            sessionId,
            phoneNumber,
            serviceCode,
            text,
            correlationId,
            requestId,
          });
      } else {
        response =
          this.invalidOption();
      }

      await ussdSessionService.saveResponse(
        requestHash,
        response
      );

      metricsService.increment(
        "ussd.service.success"
      );

      metricsService.timing(
        "ussd.service.duration",
        Date.now() -
          started
      );

      return response;
    } catch (error) {
      logger.error(
        "USSD processing failed",
        {
          error:
            error.message,
          sessionId,
          tenantId:
            tenant.id,
          correlationId,
        }
      );

      metricsService.increment(
        "ussd.service.errors"
      );

      return (
        "END Service temporarily unavailable."
      );
    }
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  async ensureSession({
    sessionId,
    tenantId,
    phoneNumber,
  }) {
    let session =
      await ussdSessionService.findSession(
        sessionId
      );

    if (!session) {
      session =
        await ussdSessionService.createSession(
          {
            sessionId,
            tenantId,
            phoneNumber,
            createdAt:
              new Date(),
            ttl:
              SESSION_TTL,
          }
        );
    }

    return session;
  }

  // ===========================================================================
  // Main Menu
  // ===========================================================================

  async mainMenu() {
    return `
CON TITech Community Capital

1. Account Balance
2. Savings
3. Loans
4. Profile
0. Exit
`.trim();
  }

  // ===========================================================================
  // Balance
  // ===========================================================================

  async balanceMenu({
    phoneNumber,
  }) {
    try {
      let balance = 0;

      if (
        savingsService?.getMemberBalance
      ) {
        balance =
          await savingsService.getMemberBalance(
            phoneNumber
          );
      }

      return `END Your savings balance is UGX ${Number(
        balance || 0
      ).toLocaleString()}`;
    } catch {
      return (
        "END Unable to retrieve balance."
      );
    }
  }

  // ===========================================================================
  // Savings
  // ===========================================================================

  async savingsMenu({
    phoneNumber,
  }) {
    try {
      let savings =
        [];

      if (
        savingsService?.findByPhone
      ) {
        savings =
          await savingsService.findByPhone(
            phoneNumber
          );
      }

      const total =
        savings.reduce(
          (
            sum,
            item
          ) =>
            sum +
            Number(
              item.amount ||
                0
            ),
          0
        );

      return `END Total savings: UGX ${total.toLocaleString()}`;
    } catch {
      return (
        "END Unable to retrieve savings."
      );
    }
  }

  // ===========================================================================
  // Loans
  // ===========================================================================

  async loanMenu({
    phoneNumber,
  }) {
    try {
      let loans = [];

      if (
        loanService?.findActiveLoans
      ) {
        loans =
          await loanService.findActiveLoans(
            phoneNumber
          );
      }

      if (!loans.length) {
        return (
          "END No active loans."
        );
      }

      const total =
        loans.reduce(
          (
            sum,
            loan
          ) =>
            sum +
            Number(
              loan.balance ||
                0
            ),
          0
        );

      return `END Outstanding loans: UGX ${total.toLocaleString()}`;
    } catch {
      return (
        "END Unable to retrieve loan information."
      );
    }
  }

  // ===========================================================================
  // Profile
  // ===========================================================================

  async profileMenu({
    phoneNumber,
  }) {
    try {
      let member;

      if (
        memberService?.findByPhone
      ) {
        member =
          await memberService.findByPhone(
            phoneNumber
          );
      }

      if (!member) {
        return (
          "END Member profile not found."
        );
      }

      return `
END Name: ${member.name}
Member No: ${
        member.memberNumber ||
        "N/A"
      }
Status: ${
        member.status ||
        "Active"
      }
`.trim();
    } catch {
      return (
        "END Unable to retrieve profile."
      );
    }
  }

  // ===========================================================================
  // Dynamic Routing
  // ===========================================================================

  routeDynamic(text) {
    const parts =
      text.split(
        MENU_SEPARATOR
      );

    const root =
      parts[0];

    return this.handlers.get(
      root
    );
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  invalidOption() {
    return `
END Invalid option.

Please try again.
`.trim();
  }

  // ===========================================================================
  // Notifications
  // ===========================================================================

  async sendNotification(
    payload
  ) {
    try {
      if (
        notificationService?.send
      ) {
        await notificationService.send(
          payload
        );
      }
    } catch (error) {
      logger.error(
        "USSD notification failed",
        {
          error:
            error.message,
        }
      );
    }
  }

  // ===========================================================================
  // Session Cleanup
  // ===========================================================================

  async terminateSession(
    sessionId
  ) {
    try {
      await ussdSessionService.endSession(
        sessionId
      );

      metricsService.increment(
        "ussd.sessions.terminated"
      );
    } catch (error) {
      logger.error(
        "Session termination failed",
        {
          sessionId,
          error:
            error.message,
        }
      );
    }
  }

  // ===========================================================================
  // Health
  // ===========================================================================

  async health() {
    return {
      status: "healthy",
      registeredMenus:
        this.handlers.size,
      uptime:
        process.uptime(),
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new USSDService();