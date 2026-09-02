/**
 * TITech Community Capital LTD
 * Risk Scoring Engine
 *
 * Centralized payment risk evaluation.
 *
 * Produces normalized risk scores
 * consumed by fraud, AML and KYC pipelines.
 */


const RISK_FACTORS = Object.freeze({

  HIGH_AMOUNT: 25,

  RAPID_TRANSACTIONS: 20,

  FAILED_ATTEMPTS: 15,

  NEW_CUSTOMER: 10,

  KYC_PENDING: 30,

  AML_MATCH: 50,

  DEVICE_CHANGE: 15

});


class RiskScoringEngine {


  constructor() {

    this.factors = RISK_FACTORS;

  }


  calculate(context = {}) {


    let score = 0;

    const reasons = [];


    if (
      context.amount &&
      context.amount >
      context.threshold
    ) {

      score += this.factors.HIGH_AMOUNT;

      reasons.push(
        "HIGH_TRANSACTION_AMOUNT"
      );

    }


    if (
      context.transactionVelocity >
      5
    ) {

      score +=
        this.factors.RAPID_TRANSACTIONS;

      reasons.push(
        "HIGH_TRANSACTION_VELOCITY"
      );

    }



    if (
      context.failedAttempts
    ) {

      score +=
        this.factors.FAILED_ATTEMPTS;

      reasons.push(
        "FAILED_PAYMENT_ATTEMPTS"
      );

    }



    if (
      context.kycStatus !== "VERIFIED"
    ) {

      score +=
        this.factors.KYC_PENDING;

      reasons.push(
        "KYC_NOT_VERIFIED"
      );

    }



    if (
      context.amlMatch
    ) {

      score +=
        this.factors.AML_MATCH;

      reasons.push(
        "AML_MATCH"
      );

    }



    return {

      score,

      reasons,

      level:
        this.getRiskLevel(score)

    };

  }



  getRiskLevel(score) {


    if(score >= 70)
      return "CRITICAL";


    if(score >= 40)
      return "HIGH";


    if(score >= 20)
      return "MEDIUM";


    return "LOW";

  }


}


module.exports =
new RiskScoringEngine();