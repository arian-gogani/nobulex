import { sha256Object, generateId } from '@stele/crypto';

export type {
  TrustFuture,
  AgentInsurancePolicy,
  RiskAssessment,
  RiskFactor,
  Settlement,
  ReputationData,
} from './types';

import type {
  TrustFuture,
  AgentInsurancePolicy,
  RiskAssessment,
  RiskFactor,
  Settlement,
  ReputationData,
} from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PricingConfig {
  riskWeights?: {
    breachHistory: number;   // default 0.30
    trustDeficit: number;    // default 0.25
    complianceGap: number;   // default 0.25
    stakeRatio: number;      // default 0.10
    maturity: number;        // default 0.10
  };
  premiumMultiplier?: number;  // default 1.5
  minimumPremiumRate?: number; // default 0.01
  maturityHalfLife?: number;   // default 365 (days)
}

const DEFAULT_RISK_WEIGHTS = {
  breachHistory: 0.30,
  trustDeficit: 0.25,
  complianceGap: 0.25,
  stakeRatio: 0.10,
  maturity: 0.10,
};

const DEFAULT_PREMIUM_MULTIPLIER = 1.5;
const DEFAULT_MINIMUM_PREMIUM_RATE = 0.01;
const DEFAULT_MATURITY_HALF_LIFE = 365;

function resolveConfig(config?: PricingConfig) {
  const weights = { ...DEFAULT_RISK_WEIGHTS, ...config?.riskWeights };
  const premiumMultiplier = config?.premiumMultiplier ?? DEFAULT_PREMIUM_MULTIPLIER;
  const minimumPremiumRate = config?.minimumPremiumRate ?? DEFAULT_MINIMUM_PREMIUM_RATE;
  const maturityHalfLife = config?.maturityHalfLife ?? DEFAULT_MATURITY_HALF_LIFE;
  return { weights, premiumMultiplier, minimumPremiumRate, maturityHalfLife };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a PricingConfig is well-formed.
 * - Risk weights must be non-negative and sum to approximately 1.0.
 * - premiumMultiplier must be > 0.
 * - minimumPremiumRate must be >= 0.
 * - maturityHalfLife must be > 0.
 */
export function validatePricingConfig(config: PricingConfig): void {
  if (config.riskWeights) {
    const w = { ...DEFAULT_RISK_WEIGHTS, ...config.riskWeights };
    for (const [name, val] of Object.entries(w)) {
      if (val < 0) {
        throw new Error(`Risk weight '${name}' must be >= 0, got ${val}`);
      }
    }
    const sum = Object.values(w).reduce((s, v) => s + v, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(
        `Risk weights must sum to approximately 1.0, got ${sum}`,
      );
    }
  }

  if (config.premiumMultiplier !== undefined && config.premiumMultiplier <= 0) {
    throw new Error(
      `premiumMultiplier must be > 0, got ${config.premiumMultiplier}`,
    );
  }

  if (config.minimumPremiumRate !== undefined && config.minimumPremiumRate < 0) {
    throw new Error(
      `minimumPremiumRate must be >= 0, got ${config.minimumPremiumRate}`,
    );
  }

  if (config.maturityHalfLife !== undefined && config.maturityHalfLife <= 0) {
    throw new Error(
      `maturityHalfLife must be > 0, got ${config.maturityHalfLife}`,
    );
  }
}

/**
 * Validate ReputationData fields are within acceptable ranges.
 */
export function validateReputationData(reputation: ReputationData): void {
  if (reputation.trustScore < 0 || reputation.trustScore > 1) {
    throw new Error(
      `trustScore must be in [0, 1], got ${reputation.trustScore}`,
    );
  }
  if (reputation.complianceRate < 0 || reputation.complianceRate > 1) {
    throw new Error(
      `complianceRate must be in [0, 1], got ${reputation.complianceRate}`,
    );
  }
  if (reputation.breachCount < 0) {
    throw new Error(`breachCount must be >= 0, got ${reputation.breachCount}`);
  }
  if (reputation.totalInteractions < 0) {
    throw new Error(
      `totalInteractions must be >= 0, got ${reputation.totalInteractions}`,
    );
  }
  if (reputation.breachCount > reputation.totalInteractions) {
    throw new Error(
      `breachCount (${reputation.breachCount}) must be <= totalInteractions (${reputation.totalInteractions})`,
    );
  }
  if (reputation.stakeAmount < 0) {
    throw new Error(
      `stakeAmount must be >= 0, got ${reputation.stakeAmount}`,
    );
  }
  if (reputation.age < 0) {
    throw new Error(`age must be >= 0, got ${reputation.age}`);
  }
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Compute risk from reputation data.
 *
 * Factors:
 * - breachHistory (configurable weight): breachCount / totalInteractions
 * - trustDeficit (configurable weight): 1 - trustScore
 * - complianceGap (configurable weight): 1 - complianceRate
 * - stakeRatio (configurable weight): 1 - min(stakeAmount, 1)
 * - maturity (configurable weight): 1 / (1 + age/maturityHalfLife)
 *
 * breachProbability = weighted sum of factors
 * expectedLoss = breachProbability * coverage-based factor (derived from risk)
 * recommendedPremium = expectedLoss * premiumMultiplier
 */
export function assessRisk(
  agentId: string,
  reputation: ReputationData,
  config?: PricingConfig,
): RiskAssessment {
  if (config) validatePricingConfig(config);
  validateReputationData(reputation);

  const { weights, premiumMultiplier, maturityHalfLife } = resolveConfig(config);

  const breachHistoryValue = reputation.totalInteractions > 0
    ? reputation.breachCount / reputation.totalInteractions
    : 0;
  const trustDeficitValue = 1 - reputation.trustScore;
  const complianceGapValue = 1 - reputation.complianceRate;
  const stakeRatioValue = 1 - Math.min(reputation.stakeAmount, 1);
  const maturityValue = 1 / (1 + reputation.age / maturityHalfLife);

  const factors: RiskFactor[] = [
    { name: 'breachHistory', weight: weights.breachHistory, value: breachHistoryValue },
    { name: 'trustDeficit', weight: weights.trustDeficit, value: trustDeficitValue },
    { name: 'complianceGap', weight: weights.complianceGap, value: complianceGapValue },
    { name: 'stakeRatio', weight: weights.stakeRatio, value: stakeRatioValue },
    { name: 'maturity', weight: weights.maturity, value: maturityValue },
  ];

  const breachProbability = factors.reduce((sum, f) => sum + f.weight * f.value, 0);
  const expectedLoss = breachProbability * breachProbability;
  const recommendedPremium = expectedLoss * premiumMultiplier;

  return {
    agentId,
    breachProbability,
    expectedLoss,
    recommendedPremium,
    factors,
  };
}

/**
 * Compute insurance premium from risk, coverage, and term.
 *
 * premium = risk.breachProbability * coverage * (term / 365) * premiumMultiplier
 * Minimum premium = coverage * minimumPremiumRate
 */
export function priceInsurance(
  risk: RiskAssessment,
  coverage: number,
  term: number,
  config?: PricingConfig,
): number {
  if (config) validatePricingConfig(config);

  if (coverage <= 0) {
    throw new Error(`coverage must be > 0, got ${coverage}`);
  }
  if (term <= 0) {
    throw new Error(`term must be > 0, got ${term}`);
  }

  const { premiumMultiplier, minimumPremiumRate } = resolveConfig(config);

  const computed = risk.breachProbability * coverage * (term / 365) * premiumMultiplier;
  const minimum = coverage * minimumPremiumRate;
  return Math.max(computed, minimum);
}

/**
 * Creates an AgentInsurancePolicy with computed premium.
 */
export function createPolicy(
  agentId: string,
  covenantId: string,
  assessment: RiskAssessment,
  coverage: number,
  term: number,
  underwriter: string,
  config?: PricingConfig,
): AgentInsurancePolicy {
  if (coverage <= 0) {
    throw new Error(`coverage must be > 0, got ${coverage}`);
  }
  if (term <= 0) {
    throw new Error(`term must be > 0, got ${term}`);
  }

  const premium = priceInsurance(assessment, coverage, term, config);
  return {
    id: generateId(),
    agentId,
    covenantId,
    coverage,
    premium,
    underwriter,
    riskScore: assessment.breachProbability,
    term,
    status: 'active',
    createdAt: Date.now(),
  };
}

/**
 * Creates a TrustFuture.
 */
export function createFuture(
  agentId: string,
  metric: TrustFuture['metric'],
  targetValue: number,
  settlementDate: number,
  premium: number,
  holder: string,
): TrustFuture {
  if (premium <= 0) {
    throw new Error(`premium must be > 0, got ${premium}`);
  }

  return {
    id: generateId(),
    agentId,
    metric,
    targetValue,
    settlementDate,
    premium,
    holder,
    status: 'active',
  };
}

/**
 * Settles a future with proportional payout based on distance from target.
 *
 * "Metric met" logic:
 * - trustScore: actualValue >= targetValue (higher is better)
 * - complianceRate: actualValue >= targetValue (higher is better)
 * - breachProbability: actualValue <= targetValue (lower is better)
 *
 * Proportional payout:
 * - If metric met: payout = premium * (1 + min(2, (actualValue - targetValue) / targetValue))
 *   For breachProbability (inverted): payout = premium * (1 + min(2, (targetValue - actualValue) / targetValue))
 * - If metric not met: payout = premium * max(0, 1 - (targetValue - actualValue) / targetValue)
 *   For breachProbability (inverted): payout = premium * max(0, 1 - (actualValue - targetValue) / targetValue)
 */
export function settleFuture(future: TrustFuture, actualValue: number): Settlement {
  let metricMet: boolean;
  let payout: number;

  switch (future.metric) {
    case 'trustScore':
    case 'complianceRate': {
      metricMet = actualValue >= future.targetValue;
      if (metricMet) {
        const bonus = future.targetValue > 0
          ? Math.min(2, (actualValue - future.targetValue) / future.targetValue)
          : 0;
        payout = future.premium * (1 + bonus);
      } else {
        const shortfall = future.targetValue > 0
          ? (future.targetValue - actualValue) / future.targetValue
          : 1;
        payout = future.premium * Math.max(0, 1 - shortfall);
      }
      break;
    }
    case 'breachProbability': {
      metricMet = actualValue <= future.targetValue;
      if (metricMet) {
        const bonus = future.targetValue > 0
          ? Math.min(2, (future.targetValue - actualValue) / future.targetValue)
          : 0;
        payout = future.premium * (1 + bonus);
      } else {
        const excess = future.targetValue > 0
          ? (actualValue - future.targetValue) / future.targetValue
          : 1;
        payout = future.premium * Math.max(0, 1 - excess);
      }
      break;
    }
    default:
      metricMet = false;
      payout = 0;
  }

  return {
    futureId: future.id,
    actualValue,
    targetValue: future.targetValue,
    payout,
    settledAt: Date.now(),
  };
}

/**
 * Claims against an insurance policy.
 *
 * Validates:
 * - Loss must be > 0
 * - Loss must be <= coverage
 * - Policy must be 'active'
 *
 * Returns proportional payout: min(lossAmount, coverage).
 */
export function claimPolicy(
  policy: AgentInsurancePolicy,
  lossAmount: number,
): { policy: AgentInsurancePolicy; payout: number } {
  if (lossAmount <= 0) {
    throw new Error(`lossAmount must be > 0, got ${lossAmount}`);
  }
  if (lossAmount > policy.coverage) {
    throw new Error(
      `lossAmount (${lossAmount}) must be <= coverage (${policy.coverage})`,
    );
  }
  if (policy.status !== 'active') {
    throw new Error(
      `Policy must be active to claim, current status: '${policy.status}'`,
    );
  }

  const payout = Math.min(lossAmount, policy.coverage);
  const updatedPolicy: AgentInsurancePolicy = {
    ...policy,
    status: 'claimed',
  };
  return { policy: updatedPolicy, payout };
}

// ---------------------------------------------------------------------------
// Standard Normal Distribution helpers
// ---------------------------------------------------------------------------

/**
 * Approximate the standard normal cumulative distribution function (CDF)
 * using the Abramowitz & Stegun rational approximation (formula 26.2.17).
 *
 * Phi(x) = P(Z <= x) where Z ~ N(0, 1)
 *
 * For x >= 0, the upper tail probability Q(x) = 1 - Phi(x) is approximated as:
 *   Q(x) = phi(x) * (a1*t + a2*t^2 + a3*t^3 + a4*t^4 + a5*t^5)
 * where t = 1/(1 + p*x), phi(x) = (1/sqrt(2*pi)) * exp(-x^2/2)
 *
 * For x < 0, use symmetry: Phi(x) = 1 - Phi(-x) = Q(-x)
 *
 * Maximum absolute error: 7.5e-8
 */
function normalCDF(x: number): number {
  // Constants for the Abramowitz & Stegun approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const absX = Math.abs(x);

  const t = 1.0 / (1.0 + p * absX);
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;

  // phi(x) = (1/sqrt(2*pi)) * exp(-x^2/2)  (standard normal PDF)
  const phi = (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-absX * absX / 2);

  // Q(|x|) = upper tail probability for |x|
  const tail = (a1 * t + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5) * phi;

  // For x >= 0: Phi(x) = 1 - Q(x)
  // For x < 0:  Phi(x) = Q(-x) = Q(|x|) = tail
  if (x >= 0) {
    return 1.0 - tail;
  } else {
    return tail;
  }
}

/**
 * Approximate the inverse of the standard normal CDF (quantile function)
 * using Beasley-Springer-Moro algorithm.
 *
 * Given probability p in (0, 1), returns x such that Phi(x) = p.
 */
function normalInverseCDF(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new Error(`Probability must be in (0, 1), got ${p}`);
  }

  // Rational approximation for the central region
  const a = [
    -3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
    4.374664141464968e+00, 2.938163982698783e+00,
  ];
  const d = [
    7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number;
  let r: number;

  if (p < pLow) {
    // Rational approximation for lower region
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    // Rational approximation for central region
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    // Rational approximation for upper region
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// ---------------------------------------------------------------------------
// Black-Scholes Pricing
// ---------------------------------------------------------------------------

/**
 * Parameters for Black-Scholes option pricing applied to behavioral contracts.
 */
export interface BlackScholesParams {
  /** Current value of the underlying (e.g., current trust score or stake value) */
  spotPrice: number;
  /** Strike price (threshold value that triggers the contract) */
  strikePrice: number;
  /** Time to maturity in years */
  timeToMaturity: number;
  /** Risk-free interest rate (annualized, e.g., 0.05 for 5%) */
  riskFreeRate: number;
  /** Volatility of the underlying (annualized standard deviation, e.g., 0.2 for 20%) */
  volatility: number;
  /** Option type: 'call' (right to buy/benefit when value rises) or 'put' (right to sell/protection when value falls) */
  optionType: 'call' | 'put';
}

/**
 * Result of Black-Scholes pricing.
 */
export interface BlackScholesResult {
  /** The theoretical price of the option/contract */
  price: number;
  /** d1 parameter from the Black-Scholes formula */
  d1: number;
  /** d2 parameter from the Black-Scholes formula */
  d2: number;
  /** N(d1) - cumulative normal at d1 */
  nd1: number;
  /** N(d2) - cumulative normal at d2 */
  nd2: number;
  /** Human-readable formula derivation */
  formula: string;
}

/**
 * Compute the Black-Scholes price for an options-style behavioral contract.
 *
 * The Black-Scholes formula for a European call option:
 *
 *   C = S * N(d1) - K * e^(-rT) * N(d2)
 *
 * For a European put option (via put-call parity):
 *
 *   P = K * e^(-rT) * N(-d2) - S * N(-d1)
 *
 * where:
 *   d1 = [ln(S/K) + (r + sigma^2/2) * T] / (sigma * sqrt(T))
 *   d2 = d1 - sigma * sqrt(T)
 *   S = spot price (current underlying value)
 *   K = strike price
 *   T = time to maturity
 *   r = risk-free rate
 *   sigma = volatility
 *   N(x) = standard normal CDF
 *
 * In the context of behavioral contracts:
 * - A "call" prices the right to benefit when an agent's performance exceeds a threshold
 * - A "put" prices protection against an agent's performance falling below a threshold
 */
export function blackScholesPrice(params: BlackScholesParams): BlackScholesResult {
  const { spotPrice: S, strikePrice: K, timeToMaturity: T, riskFreeRate: r, volatility: sigma, optionType } = params;

  if (S <= 0) {
    throw new Error(`spotPrice must be > 0, got ${S}`);
  }
  if (K <= 0) {
    throw new Error(`strikePrice must be > 0, got ${K}`);
  }
  if (T <= 0) {
    throw new Error(`timeToMaturity must be > 0, got ${T}`);
  }
  if (sigma <= 0) {
    throw new Error(`volatility must be > 0, got ${sigma}`);
  }

  // d1 = [ln(S/K) + (r + sigma^2/2) * T] / (sigma * sqrt(T))
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);

  // d2 = d1 - sigma * sqrt(T)
  const d2 = d1 - sigma * sqrtT;

  const nd1 = normalCDF(d1);
  const nd2 = normalCDF(d2);

  let price: number;
  const discountFactor = Math.exp(-r * T);

  if (optionType === 'call') {
    // C = S * N(d1) - K * e^(-rT) * N(d2)
    price = S * nd1 - K * discountFactor * nd2;
  } else {
    // P = K * e^(-rT) * N(-d2) - S * N(-d1)
    price = K * discountFactor * normalCDF(-d2) - S * normalCDF(-d1);
  }

  // Ensure price is non-negative (numerical precision)
  price = Math.max(0, price);

  const formula =
    `Black-Scholes ${optionType} pricing:\n` +
    `  S=${S}, K=${K}, T=${T}, r=${r}, sigma=${sigma}\n` +
    `  d1 = [ln(${S}/${K}) + (${r} + ${sigma}^2/2)*${T}] / (${sigma}*sqrt(${T})) = ${d1.toFixed(6)}\n` +
    `  d2 = d1 - sigma*sqrt(T) = ${d2.toFixed(6)}\n` +
    `  N(d1) = ${nd1.toFixed(6)}, N(d2) = ${nd2.toFixed(6)}\n` +
    `  Price = ${price.toFixed(6)}`;

  return { price, d1, d2, nd1, nd2, formula };
}

// ---------------------------------------------------------------------------
// Value at Risk (VaR)
// ---------------------------------------------------------------------------

/**
 * Parameters for Value at Risk computation.
 */
export interface VaRParams {
  /** The portfolio or position value */
  portfolioValue: number;
  /** Expected return (mean) over the time horizon */
  expectedReturn: number;
  /** Standard deviation of returns over the time horizon */
  volatility: number;
  /** Confidence level, e.g., 0.95 for 95% VaR (must be in (0, 1)) */
  confidenceLevel: number;
  /** Optional: time horizon in days (default 1) for scaling */
  timeHorizonDays?: number;
}

/**
 * Result of Value at Risk computation.
 */
export interface VaRResult {
  /** The VaR amount (maximum expected loss at the given confidence level) */
  valueAtRisk: number;
  /** The z-score corresponding to the confidence level */
  zScore: number;
  /** VaR as a percentage of portfolio value */
  varPercentage: number;
  /** Human-readable derivation */
  formula: string;
}

/**
 * Compute the parametric (variance-covariance) Value at Risk (VaR).
 *
 * VaR answers: "What is the maximum loss we expect to see over a given
 * time horizon, at a given confidence level?"
 *
 * Under the assumption of normally distributed returns:
 *
 *   VaR = portfolioValue * (expectedReturn - z_alpha * volatility * sqrt(T))
 *
 * where:
 *   z_alpha = the z-score for the confidence level (e.g., 1.645 for 95%)
 *   T = time horizon in days
 *
 * Since VaR represents a loss, we negate if the result is positive:
 *   VaR = -portfolioValue * (expectedReturn * T - z_alpha * volatility * sqrt(T))
 *
 * The result is the maximum loss (positive number) at the given confidence level.
 *
 * Note: This uses the parametric (Gaussian) approach. Real-world distributions
 * have fat tails, so historical or Monte Carlo VaR may be more appropriate.
 */
export function valueAtRisk(params: VaRParams): VaRResult {
  const {
    portfolioValue,
    expectedReturn,
    volatility,
    confidenceLevel,
    timeHorizonDays = 1,
  } = params;

  if (portfolioValue <= 0) {
    throw new Error(`portfolioValue must be > 0, got ${portfolioValue}`);
  }
  if (volatility < 0) {
    throw new Error(`volatility must be >= 0, got ${volatility}`);
  }
  if (confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new Error(
      `confidenceLevel must be in (0, 1), got ${confidenceLevel}`,
    );
  }
  if (timeHorizonDays <= 0) {
    throw new Error(`timeHorizonDays must be > 0, got ${timeHorizonDays}`);
  }

  // z-score for the confidence level (left tail)
  const zScore = normalInverseCDF(confidenceLevel);
  const sqrtT = Math.sqrt(timeHorizonDays);

  // VaR = -(mu * T - z * sigma * sqrt(T)) * portfolioValue
  // = (z * sigma * sqrt(T) - mu * T) * portfolioValue
  const varValue = portfolioValue * (zScore * volatility * sqrtT - expectedReturn * timeHorizonDays);

  // VaR should be non-negative (if expected return is very high, there may be no loss)
  const valueAtRiskResult = Math.max(0, varValue);
  const varPercentage = valueAtRiskResult / portfolioValue;

  const formula =
    `Parametric VaR at ${(confidenceLevel * 100).toFixed(1)}% confidence:\n` +
    `  Portfolio value: ${portfolioValue}\n` +
    `  z-score: ${zScore.toFixed(6)}\n` +
    `  VaR = portfolio * (z * sigma * sqrt(T) - mu * T)\n` +
    `       = ${portfolioValue} * (${zScore.toFixed(4)} * ${volatility} * sqrt(${timeHorizonDays}) - ${expectedReturn} * ${timeHorizonDays})\n` +
    `       = ${valueAtRiskResult.toFixed(6)}\n` +
    `  VaR as % of portfolio: ${(varPercentage * 100).toFixed(4)}%`;

  return {
    valueAtRisk: valueAtRiskResult,
    zScore,
    varPercentage,
    formula,
  };
}

// ---------------------------------------------------------------------------
// Hedge Ratio
// ---------------------------------------------------------------------------

/**
 * Parameters for optimal hedge ratio computation.
 */
export interface HedgeRatioParams {
  /** Standard deviation of the asset being hedged */
  assetVolatility: number;
  /** Standard deviation of the hedging instrument */
  hedgeVolatility: number;
  /** Correlation coefficient between the asset and hedge instrument, in [-1, 1] */
  correlation: number;
  /** Optional: the notional value of the position being hedged */
  positionSize?: number;
}

/**
 * Result of hedge ratio computation.
 */
export interface HedgeRatioResult {
  /** The optimal hedge ratio (proportion of position to hedge) */
  hedgeRatio: number;
  /** The optimal hedge position size (if positionSize was provided) */
  hedgePositionSize: number | null;
  /** The proportion of variance eliminated by the optimal hedge (R^2) */
  hedgeEffectiveness: number;
  /** Human-readable derivation */
  formula: string;
}

/**
 * Compute the minimum variance hedge ratio for correlated risks.
 *
 * The optimal hedge ratio minimizes the variance of the hedged portfolio.
 * For an asset with returns R_a and a hedging instrument with returns R_h:
 *
 *   h* = rho * (sigma_a / sigma_h)
 *
 * where:
 *   h* = optimal hedge ratio
 *   rho = correlation between R_a and R_h
 *   sigma_a = standard deviation of R_a
 *   sigma_h = standard deviation of R_h
 *
 * This is derived by minimizing Var(R_a - h * R_h) with respect to h:
 *   Var(R_a - h * R_h) = sigma_a^2 - 2*h*rho*sigma_a*sigma_h + h^2*sigma_h^2
 *   d/dh = -2*rho*sigma_a*sigma_h + 2*h*sigma_h^2 = 0
 *   h* = rho * sigma_a / sigma_h
 *
 * Hedge effectiveness (R^2) = rho^2 (proportion of variance eliminated)
 *
 * The hedge position size = h* * positionSize
 */
export function hedgeRatio(params: HedgeRatioParams): HedgeRatioResult {
  const { assetVolatility, hedgeVolatility, correlation, positionSize } = params;

  if (assetVolatility < 0) {
    throw new Error(`assetVolatility must be >= 0, got ${assetVolatility}`);
  }
  if (hedgeVolatility <= 0) {
    throw new Error(`hedgeVolatility must be > 0, got ${hedgeVolatility}`);
  }
  if (correlation < -1 || correlation > 1) {
    throw new Error(`correlation must be in [-1, 1], got ${correlation}`);
  }
  if (positionSize !== undefined && positionSize <= 0) {
    throw new Error(`positionSize must be > 0, got ${positionSize}`);
  }

  // h* = rho * (sigma_a / sigma_h)
  const ratio = correlation * (assetVolatility / hedgeVolatility);

  // Hedge effectiveness = rho^2
  const hedgeEffectiveness = correlation * correlation;

  const hedgePositionSize = positionSize !== undefined ? ratio * positionSize : null;

  const formula =
    `Minimum variance hedge ratio:\n` +
    `  h* = rho * (sigma_a / sigma_h)\n` +
    `     = ${correlation} * (${assetVolatility} / ${hedgeVolatility})\n` +
    `     = ${ratio.toFixed(6)}\n` +
    `  Hedge effectiveness (R^2) = rho^2 = ${correlation}^2 = ${hedgeEffectiveness.toFixed(6)}\n` +
    (hedgePositionSize !== null
      ? `  Hedge position size = ${ratio.toFixed(6)} * ${positionSize} = ${hedgePositionSize.toFixed(6)}`
      : `  No position size provided`);

  return {
    hedgeRatio: ratio,
    hedgePositionSize,
    hedgeEffectiveness,
    formula,
  };
}
