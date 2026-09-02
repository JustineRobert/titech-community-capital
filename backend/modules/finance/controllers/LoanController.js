//  backend/modules/finance/controllers/LoanController.js
'use strict';

const LoanService = require('../services/LoanService');
const Loan = require('../models/Loan');

class LoanController {
  static async createLoan(req, res, next) {
    try {
      const loan = await Loan.create({
        ...req.body,
        tenantId: req.tenantId,
      });

      res.status(201).json(loan);
    } catch (error) {
      next(error);
    }
  }

  static async approveLoan(req, res, next) {
    try {
      const loan = await LoanService.approveLoan(req.params.id);
      res.json(loan);
    } catch (error) {
      next(error);
    }
  }

  static async disburseLoan(req, res, next) {
    try {
      const { cashAccountId, loanAccountId } = req.body;

      const loan = await LoanService.disburseLoan(
        req.params.id,
        cashAccountId,
        loanAccountId
      );

      res.json(loan);
    } catch (error) {
      next(error);
    }
  }

  static async repayLoan(req, res, next) {
    try {
      const { amount, cashAccountId, loanAccountId } = req.body;

      const loan = await LoanService.repayLoan(
        req.params.id,
        amount,
        cashAccountId,
        loanAccountId
      );

      res.json(loan);
    } catch (error) {
      next(error);
    }
  }

  static async getLoan(req, res, next) {
    try {
      const loan = await Loan.findById(req.params.id);
      res.json(loan);
    } catch (error) {
      next(error);
    }
  }

  static async getLoans(req, res, next) {
    try {
      const loans = await Loan.find({ tenantId: req.tenantId });
      res.json(loans);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = LoanController;