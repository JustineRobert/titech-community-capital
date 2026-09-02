/**
 * loanScoringService.js
 *
 * Production-grade loan eligibility scoring engine
 * Configurable weights, thresholds, and risk assessment
 * Audit-friendly with transparent component scoring
 */

const Contribution = require('../models/Contribution');
const Loan = require('../models/Loan');
//const LoanRepaymentSchedule = require('../models/LoanRepaymentSchedule');
const LoanEligibility = require('../models/LoanEligibility');
const LoanAudit = require('../models/LoanAudit');
const User = require('../models/User');
const Group = require('../models/Group');

/**
 * Configuration for scoring (can be moved to env or database)
 * PRODUCTION-READY with configurable thresholds
 */
const SCORING_CONFIG = {
  // Weights for each component (sum = 100)
  weights: {
    contribution: 0.4, // 40%
    participation: 0.3, // 30%
    repayment: 0.2, // 20%
    risk: 0.1, // 10%
  },

  // Contribution score thresholds (max 40 points)
  contribution: {
    monthsForFullPoints: 12, // Months to reach max 40 points
    minMonthsActive: 2, // Minimum 2 months
    minTotalAmount: 5000, // Minimum total contributions
    amountThresholds: {
      10000: 40, // 40 points if >= 10K
      5000: 25, // 25 points if >= 5K
      2000: 15, // 15 points if >= 2K
      0: 5, // 5 points minimum
    },
    // Bonus multipliers for different contexts
    bonusMultipliers: {
      earlyStage: 1.2, // 20% bonus if < 6 months
      consistent: 1.15, // 15% bonus for consistency
    },
  },

  // Participation score (max 30 points)
  participation: {
    meetingAttendanceWeight: 0.6,
    contributionConsistencyWeight: 0.4,
    minMeetingsAttended: 2,
    // Track meeting attendance if available
    attendanceBonus: 5, // Extra points for high attendance
  },

  // Repayment history score (max 20 points)
  repayment: {
    maxPreviousLoans: 5, // Cap at 5 for comparison
    completedLoanBonus: 4, // Points per completed loan
    onTimeBonus: 10, // Full bonus for 100% on-time
    defaultPenalty: -20, // Severe penalty for default
    latePaymentThreshold: 7, // Days late to count as late
    latePaymentPenalty: 0.5, // Reduce score per late payment
  },

  // Risk factors (max 10 points, deductions)
  risk: {
    activeLoanPenalty: 3, // Per active loan
    maxActiveLoansCap: 3, // Don't penalize beyond 3 active
    outstandingLoanRatio: 0.5, // If outstanding > 50% of contributed, penalize
    recentDefaultMonths: 12, // Look back 12 months for defaults
    debtToIncomeRatio: 0.8, // Maximum debt to income ratio allowed
  },

  // Eligibility thresholds
  thresholds: {
    minOverallScore: 50, // Minimum overall score to be eligible
    minContributionScore: 10, // Minimum contribution
    minGroupTenureMonths: 2, // Minimum months in group
    maxScore: 100, // Maximum achievable score
  },

  // Max loan calculation
  maxLoanMultiplier: 2.5, // Can borrow 2.5x total contributed
  minLoanAmount: 1000,
  maxLoanAmount: 500000,

  // Assessment validity
  assessmentValidityDays: 30, // Re-assess every 30 days

  // Appeal period (days after rejection during which user can appeal)
  appealPeriodDays: 14,
};

/**
 * Calculate contribution score (0-40 points)
 * Based on: months active, total amount, contribution count, consistency
 */
async function calculateContributionScore(userId, groupId) {
  const contributions = await Contribution.find({
    user: userId,
    group: groupId,
  }).sort({ createdAt: 1 });

  if (contributions.length === 0) {
    return {
      score: 0,
      data: {
        monthsActive: 0,
        totalContributed: 0,
        contributionCount: 0,
        averageContribution: 0,
      },
    };
  }

  // Calculate months active
  const firstContribution = contributions[0].createdAt;
  const monthsActive = Math.floor(
    (new Date() - new Date(firstContribution)) / (30 * 24 * 60 * 60 * 1000)
  );

  if (monthsActive < SCORING_CONFIG.contribution.minMonthsActive) {
    return {
      score: 0,
      data: {
        monthsActive,
        totalContributed: 0,
        contributionCount: 0,
        averageContribution: 0,
        reason: `Insufficient group tenure: ${monthsActive} months < ${SCORING_CONFIG.contribution.minMonthsActive} required`,
      },
    };
  }

  // Calculate totals
  const totalContributed = contributions.reduce((sum, c) => sum + (c.amount || 0), 0);
  const averageContribution = totalContributed / contributions.length;

  // Base score from total amount
  let score = 0;
  for (const [threshold, points] of Object.entries(SCORING_CONFIG.contribution.amountThresholds)) {
    if (totalContributed >= parseInt(threshold)) {
      score = Math.max(score, points);
    }
  }

  // Bonus for months active (up to 40 points)
  const monthBonus = Math.min(
    (monthsActive / SCORING_CONFIG.contribution.monthsForFullPoints) * 40,
    40
  );
  score = (score + monthBonus) / 2; // Average the two approaches

  // Cap at 40
  score = Math.min(score, 40);

  return {
    score,
    data: {
      monthsActive,
      totalContributed,
      contributionCount: contributions.length,
      averageContribution,
    },
  };
}

/**
 * Calculate participation score (0-30 points)
 * Based on: meeting attendance, contribution consistency
 */
async function calculateParticipationScore(userId, groupId) {
  const contributions = await Contribution.find({
    user: userId,
    group: groupId,
  }).sort({ createdAt: 1 });

  if (contributions.length < SCORING_CONFIG.participation.minMeetingsAttended) {
    return { score: 0, data: { reason: 'Insufficient participation history' } };
  }

  // Calculate consistency (coefficient of variation)
  const amounts = contributions.map((c) => c.amount || 0);
  const average = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((sum, x) => sum + Math.pow(x - average, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = average > 0 ? stdDev / average : 1;

  // Consistency score (higher CV = lower consistency = lower score)
  // CV < 0.3 = highly consistent = 30 points
  // CV > 1.0 = very inconsistent = 0 points
  const consistencyScore = Math.max(0, 30 * (1 - Math.min(coefficientOfVariation, 1)));

  return {
    score: consistencyScore,
    data: {
      contributionCount: contributions.length,
      averageContribution: average,
      coefficientOfVariation: coefficientOfVariation.toFixed(2),
      consistency: coefficientOfVariation < 0.3 ? 'high' : 'low',
    },
  };
}

/**
 * Calculate repayment history score (0-20 points)
 * Based on: completed loans, on-time payment rate, defaults
 */
async function calculateRepaymentScore(userId, groupId) {
  const loans = await Loan.find({
    user: userId,
    group: groupId,
    status: { $in: ['repaid', 'approved', 'rejected'] },
  }).populate('repaymentSchedule');

  let score = 0;
  const data = {
    completedLoans: 0,
    defaultedLoans: 0,
    onTimeRepaymentRate: 100,
  };

  if (loans.length === 0) {
    // No history = neutral (5 points for benefit of doubt)
    return { score: 5, data };
  }

  // Count completed vs defaulted
  const completedLoans = loans.filter((l) => l.status === 'repaid').length;
  const defaultedLoans = loans.filter(
    (l) => l.status === 'repaid' && l.repaymentSchedule?.status === 'defaulted'
  ).length;

  data.completedLoans = completedLoans;
  data.defaultedLoans = defaultedLoans;

  // Severe penalty for defaults
  if (defaultedLoans > 0) {
    return {
      score: -20,
      data: {
        ...data,
        reason: `${defaultedLoans} defaulted loan(s)`,
      },
    };
  }

  // Award points for completed loans
  score +=
    Math.min(completedLoans, SCORING_CONFIG.repayment.maxPreviousLoans) *
    SCORING_CONFIG.repayment.completedLoanBonus;

  // Calculate on-time payment rate
  let totalInstallments = 0;
  let onTimeInstallments = 0;

  for (const loan of loans.filter((l) => l.status === 'repaid')) {
    if (loan.installments && Array.isArray(loan.installments)) {
      for (const installment of loan.installments) {
        totalInstallments++;
        if (installment.paid && installment.paidAt <= installment.dueDate) {
          onTimeInstallments++;
        }
      }
    }
  }

  if (totalInstallments > 0) {
    const onTimeRate = (onTimeInstallments / totalInstallments) * 100;
    data.onTimeRepaymentRate = Math.round(onTimeRate);

    // Bonus for 100% on-time
    if (onTimeRate === 100) {
      score += SCORING_CONFIG.repayment.onTimeBonus;
    } else if (onTimeRate >= 90) {
      score += SCORING_CONFIG.repayment.onTimeBonus * 0.8;
    } else if (onTimeRate >= 75) {
      score += SCORING_CONFIG.repayment.onTimeBonus * 0.5;
    }
  }

  // Cap at 20
  score = Math.min(score, 20);

  return { score, data };
}

/**
 * Calculate risk score adjustments (0-10 points, negative = risk)
 * Based on: active loans, outstanding balance, recent defaults
 */
async function calculateRiskScore(userId, groupId) {
  const activeLoans = await Loan.find({
    user: userId,
    group: groupId,
    status: { $in: ['approved', 'disbursed'] },
  });

  let riskDeduction = 0;
  const data = {
    activeLoans: activeLoans.length,
    totalOutstanding: 0,
  };

  // Penalize for active loans (up to 3 loans = 9 points)
  const activeLoanPenalty = Math.min(
    activeLoans.length * SCORING_CONFIG.risk.activeLoanPenalty,
    SCORING_CONFIG.risk.maxActiveLoansCap * SCORING_CONFIG.risk.activeLoanPenalty
  );
  riskDeduction += activeLoanPenalty;

  // Calculate total outstanding
  let totalOutstanding = 0;
  for (const loan of activeLoans) {
    totalOutstanding += loan.amount || 0;
  }
  data.totalOutstanding = totalOutstanding;

  // Get total contributed to compare
  const contributions = await Contribution.find({ user: userId, group: groupId });
  const totalContributed = contributions.reduce((sum, c) => sum + (c.amount || 0), 0);

  // Penalize if outstanding > 50% of contributed
  if (totalContributed > 0) {
    const outstandingRatio = totalOutstanding / totalContributed;
    if (outstandingRatio > SCORING_CONFIG.risk.outstandingLoanRatio) {
      riskDeduction += 5; // Penalize high outstanding ratio
      data.outstandingRatio = outstandingRatio.toFixed(2);
    }
  }

  // Final risk score (10 - deductions, capped at 10)
  const score = Math.max(0, 10 - riskDeduction);

  return { score, data };
}

/**
 * Main eligibility assessment function
 */
async function assessEligibility(userId, groupId, actorId, override = null) {
  try {
    // Fetch necessary data
    const user = await User.findById(userId);
    const group = await Group.findById(groupId);

    if (!user || !group) {
      throw new Error('User or group not found');
    }

    // Check if account is verified
    if (!user.isVerified) {
      return {
        isEligible: false,
        overallScore: 0,
        maxLoanAmount: 0,
        rejectionReason: 'account_not_verified',
        components: {},
        metadata: {},
      };
    }

    // Calculate all components
    const [contributionResult, participationResult, repaymentResult, riskResult] =
      await Promise.all([
        calculateContributionScore(userId, groupId),
        calculateParticipationScore(userId, groupId),
        calculateRepaymentScore(userId, groupId),
        calculateRiskScore(userId, groupId),
      ]);

    // Check minimum tenure
    if (contributionResult.data.monthsActive < SCORING_CONFIG.thresholds.minGroupTenureMonths) {
      const auditData = {
        action: 'eligibility_assessed',
        user: userId,
        group: groupId,
        actor: actorId,
        actorRole: 'system',
        description: 'Insufficient group tenure',
        metadata: {
          monthsActive: contributionResult.data.monthsActive,
          minRequired: SCORING_CONFIG.thresholds.minGroupTenureMonths,
        },
        status: 'success',
      };

      await LoanAudit.logAction(auditData);

      return {
        isEligible: false,
        overallScore: 0,
        maxLoanAmount: 0,
        rejectionReason: 'insufficient_group_membership',
        components: {
          contributionScore: 0,
          participationScore: 0,
          repaymentScore: 0,
          riskScore: 0,
        },
        metadata: {
          ...contributionResult.data,
          ...participationResult.data,
          ...repaymentResult.data,
          ...riskResult.data,
        },
      };
    }

    // Check minimum contribution score
    if (contributionResult.score < SCORING_CONFIG.thresholds.minContributionScore) {
      const auditData = {
        action: 'eligibility_assessed',
        user: userId,
        group: groupId,
        actor: actorId,
        actorRole: 'system',
        description: 'Insufficient contribution history',
        metadata: {
          score: contributionResult.score,
          minRequired: SCORING_CONFIG.thresholds.minContributionScore,
        },
        status: 'success',
      };

      await LoanAudit.logAction(auditData);

      return {
        isEligible: false,
        overallScore: 0,
        maxLoanAmount: 0,
        rejectionReason: 'insufficient_contribution',
        components: {
          contributionScore: contributionResult.score,
          participationScore: participationResult.score,
          repaymentScore: repaymentResult.score,
          riskScore: riskResult.score,
        },
        metadata: {
          ...contributionResult.data,
          ...participationResult.data,
          ...repaymentResult.data,
          ...riskResult.data,
        },
      };
    }

    // Calculate weighted overall score
    const overallScore =
      (contributionResult.score * SCORING_CONFIG.weights.contribution +
        participationResult.score * SCORING_CONFIG.weights.participation +
        repaymentResult.score * SCORING_CONFIG.weights.repayment +
        riskResult.score * SCORING_CONFIG.weights.risk) *
      100; // Scale to 0-100

    // Determine eligibility
    let isEligible = overallScore >= SCORING_CONFIG.thresholds.minOverallScore;
    let rejectionReason = null;

    if (repaymentResult.data?.reason === 'defaulted loan(s)') {
      isEligible = false;
      rejectionReason = 'recent_default';
    }

    // Apply admin override if provided
    if (override !== null) {
      isEligible = override;
      rejectionReason = override ? null : 'admin_override';
    }

    // Calculate max loan amount (based on contributions)
    let maxLoanAmount = 0;
    if (isEligible) {
      const totalContributed = contributionResult.data.totalContributed || 0;
      maxLoanAmount = Math.min(
        Math.max(totalContributed * SCORING_CONFIG.maxLoanMultiplier, SCORING_CONFIG.minLoanAmount),
        SCORING_CONFIG.maxLoanAmount
      );
    }

    // Create eligibility record
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SCORING_CONFIG.assessmentValidityDays);

    const eligibilityRecord = new LoanEligibility({
      user: userId,
      group: groupId,
      overallScore: Math.round(overallScore * 100) / 100,
      components: {
        contributionScore: contributionResult.score,
        participationScore: participationResult.score,
        repaymentScore: repaymentResult.score,
        riskScore: riskResult.score,
      },
      metadata: {
        ...contributionResult.data,
        ...participationResult.data,
        ...repaymentResult.data,
        ...riskResult.data,
      },
      isEligible,
      maxLoanAmount,
      rejectionReason,
      expiresAt,
    });

    await eligibilityRecord.save();

    // Audit log
    await LoanAudit.logAction({
      action: 'eligibility_assessed',
      user: userId,
      group: groupId,
      actor: actorId,
      actorRole: 'system',
      description: `Loan eligibility assessed: ${isEligible ? 'ELIGIBLE' : 'INELIGIBLE'}`,
      metadata: {
        score: overallScore,
        maxLoan: maxLoanAmount,
        rejectionReason,
      },
      status: 'success',
    });

    return {
      isEligible,
      overallScore: Math.round(overallScore * 100) / 100,
      maxLoanAmount,
      rejectionReason,
      components: {
        contributionScore: contributionResult.score,
        participationScore: participationResult.score,
        repaymentScore: repaymentResult.score,
        riskScore: riskResult.score,
      },
      metadata: {
        ...contributionResult.data,
        ...participationResult.data,
        ...repaymentResult.data,
        ...riskResult.data,
      },
    };
  } catch (error) {
    console.error('Error in assessEligibility:', error);
    throw error;
  }
}

/**
 * Get eligibility (use cached if valid, otherwise reassess)
 */
async function getEligibility(userId, groupId, actorId) {
  try {
    // Check for existing active assessment
    const existing = await LoanEligibility.findActiveAssessment(userId, groupId);

    if (existing) {
      return existing.toObject();
    }

    // Need to reassess
    return await assessEligibility(userId, groupId, actorId);
  } catch (error) {
    console.error('Error in getEligibility:', error);
    throw error;
  }
}

module.exports = {
  assessEligibility,
  getEligibility,
  SCORING_CONFIG,
};
