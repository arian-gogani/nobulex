import { describe, it, expect } from 'vitest';
import {
  proveHonesty,
  minimumStake,
  minimumDetection,
  expectedCostOfBreach,
  honestyMargin,
  validateParameters,
  repeatedGameEquilibrium,
  coalitionStability,
  mechanismDesign,
} from './index';
import type { HonestyParameters } from './types';
import type {
  RepeatedGameParams,
  CoalitionValue,
  MechanismDesignParams,
} from './index';

// ---------------------------------------------------------------------------
// validateParameters
// ---------------------------------------------------------------------------
describe('validateParameters', () => {
  it('accepts valid full parameters', () => {
    expect(() =>
      validateParameters({
        stakeAmount: 100,
        detectionProbability: 0.5,
        reputationValue: 50,
        maxViolationGain: 200,
        coburn: 10,
      }),
    ).not.toThrow();
  });

  it('accepts valid partial parameters', () => {
    expect(() => validateParameters({ stakeAmount: 0 })).not.toThrow();
    expect(() => validateParameters({ detectionProbability: 1 })).not.toThrow();
    expect(() => validateParameters({})).not.toThrow();
  });

  it('accepts boundary values', () => {
    expect(() =>
      validateParameters({
        stakeAmount: 0,
        detectionProbability: 0,
        reputationValue: 0,
        maxViolationGain: 0,
        coburn: 0,
      }),
    ).not.toThrow();
    expect(() => validateParameters({ detectionProbability: 1 })).not.toThrow();
  });

  it('throws on negative stakeAmount', () => {
    expect(() => validateParameters({ stakeAmount: -1 })).toThrow(
      'stakeAmount must be >= 0',
    );
  });

  it('throws on detectionProbability < 0', () => {
    expect(() => validateParameters({ detectionProbability: -0.1 })).toThrow(
      'detectionProbability must be in [0, 1]',
    );
  });

  it('throws on detectionProbability > 1', () => {
    expect(() => validateParameters({ detectionProbability: 1.5 })).toThrow(
      'detectionProbability must be in [0, 1]',
    );
  });

  it('throws on negative reputationValue', () => {
    expect(() => validateParameters({ reputationValue: -10 })).toThrow(
      'reputationValue must be >= 0',
    );
  });

  it('throws on negative maxViolationGain', () => {
    expect(() => validateParameters({ maxViolationGain: -5 })).toThrow(
      'maxViolationGain must be >= 0',
    );
  });

  it('throws on negative coburn', () => {
    expect(() => validateParameters({ coburn: -1 })).toThrow('coburn must be >= 0');
  });
});

// ---------------------------------------------------------------------------
// proveHonesty
// ---------------------------------------------------------------------------
describe('proveHonesty', () => {
  it('returns isDominantStrategy=true when honesty dominates', () => {
    const params: HonestyParameters = {
      stakeAmount: 1000,
      detectionProbability: 0.8,
      reputationValue: 500,
      maxViolationGain: 100,
      coburn: 50,
    };
    const proof = proveHonesty(params);
    // 1000*0.8 + 500 + 50 = 1350 > 100
    expect(proof.isDominantStrategy).toBe(true);
    expect(proof.margin).toBe(1350 - 100);
  });

  it('returns isDominantStrategy=false when dishonesty dominates', () => {
    const params: HonestyParameters = {
      stakeAmount: 10,
      detectionProbability: 0.1,
      reputationValue: 5,
      maxViolationGain: 1000,
      coburn: 2,
    };
    const proof = proveHonesty(params);
    // 10*0.1 + 5 + 2 = 8 < 1000
    expect(proof.isDominantStrategy).toBe(false);
    expect(proof.margin).toBe(8 - 1000);
  });

  it('returns isDominantStrategy=false at exact boundary (margin = 0)', () => {
    // stake*detection + rep + coburn = maxGain
    // 100*0.5 + 30 + 20 = 100
    const params: HonestyParameters = {
      stakeAmount: 100,
      detectionProbability: 0.5,
      reputationValue: 30,
      maxViolationGain: 100,
      coburn: 20,
    };
    const proof = proveHonesty(params);
    expect(proof.margin).toBeCloseTo(0, 10);
    expect(proof.isDominantStrategy).toBe(false);
  });

  it('computes correct requiredStake', () => {
    const params: HonestyParameters = {
      stakeAmount: 500,
      detectionProbability: 0.5,
      reputationValue: 100,
      maxViolationGain: 400,
      coburn: 50,
    };
    const proof = proveHonesty(params);
    // requiredStake = (400 - 100 - 50) / 0.5 = 500
    expect(proof.requiredStake).toBe(500);
  });

  it('computes correct requiredDetection', () => {
    const params: HonestyParameters = {
      stakeAmount: 1000,
      detectionProbability: 0.5,
      reputationValue: 100,
      maxViolationGain: 600,
      coburn: 0,
    };
    const proof = proveHonesty(params);
    // requiredDetection = (600 - 100 - 0) / 1000 = 0.5
    expect(proof.requiredDetection).toBe(0.5);
  });

  it('formula contains structured step-by-step derivation', () => {
    const params: HonestyParameters = {
      stakeAmount: 100,
      detectionProbability: 0.5,
      reputationValue: 50,
      maxViolationGain: 200,
      coburn: 10,
    };
    const proof = proveHonesty(params);
    // total = 100*0.5 + 50 + 10 = 110
    expect(proof.formula).toContain('Expected cost of dishonesty:');
    expect(proof.formula).toContain('stake(100)');
    expect(proof.formula).toContain('detection(0.5)');
    expect(proof.formula).toContain('reputation(50)');
    expect(proof.formula).toContain('coburn(10)');
    expect(proof.formula).toContain('= 110');
    expect(proof.formula).toContain('Maximum gain from violation: 200');
    expect(proof.formula).toContain('Margin: 110 - 200 = -90');
    expect(proof.formula).toContain('not dominant');
  });

  it('formula indicates dominant strategy when honesty wins', () => {
    const params: HonestyParameters = {
      stakeAmount: 1000,
      detectionProbability: 1.0,
      reputationValue: 500,
      maxViolationGain: 100,
      coburn: 100,
    };
    const proof = proveHonesty(params);
    expect(proof.formula).toContain('Honesty is dominant strategy');
    expect(proof.formula).not.toContain('not dominant');
  });

  it('formula indicates not dominant strategy when dishonesty wins', () => {
    const params: HonestyParameters = {
      stakeAmount: 1,
      detectionProbability: 0.01,
      reputationValue: 0,
      maxViolationGain: 10000,
      coburn: 0,
    };
    const proof = proveHonesty(params);
    expect(proof.formula).toContain('Honesty is not dominant strategy');
  });

  it('throws on invalid parameters', () => {
    expect(() =>
      proveHonesty({
        stakeAmount: -1,
        detectionProbability: 0.5,
        reputationValue: 50,
        maxViolationGain: 200,
        coburn: 10,
      }),
    ).toThrow('stakeAmount must be >= 0');
  });

  it('throws on detectionProbability > 1', () => {
    expect(() =>
      proveHonesty({
        stakeAmount: 100,
        detectionProbability: 1.5,
        reputationValue: 50,
        maxViolationGain: 200,
        coburn: 10,
      }),
    ).toThrow('detectionProbability must be in [0, 1]');
  });

  it('handles maxViolationGain = 0 (honesty always dominates)', () => {
    const params: HonestyParameters = {
      stakeAmount: 100,
      detectionProbability: 0.5,
      reputationValue: 50,
      maxViolationGain: 0,
      coburn: 10,
    };
    const proof = proveHonesty(params);
    // total = 100*0.5 + 50 + 10 = 110, margin = 110 - 0 = 110
    expect(proof.isDominantStrategy).toBe(true);
    expect(proof.margin).toBe(110);
  });

  it('handles all-zero parameters', () => {
    const params: HonestyParameters = {
      stakeAmount: 0,
      detectionProbability: 0,
      reputationValue: 0,
      maxViolationGain: 0,
      coburn: 0,
    };
    const proof = proveHonesty(params);
    expect(proof.margin).toBe(0);
    expect(proof.isDominantStrategy).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// minimumStake
// ---------------------------------------------------------------------------
describe('minimumStake', () => {
  it('returns correct minimum stake', () => {
    // (maxGain - rep - coburn) / detection = (400 - 100 - 50) / 0.5 = 500
    const result = minimumStake({
      detectionProbability: 0.5,
      reputationValue: 100,
      maxViolationGain: 400,
      coburn: 50,
    });
    expect(result).toBe(500);
  });

  it('returns 0 when reputation+coburn already exceeds maxGain', () => {
    const result = minimumStake({
      detectionProbability: 0.5,
      reputationValue: 500,
      maxViolationGain: 100,
      coburn: 50,
    });
    expect(result).toBe(0);
  });

  it('returns Infinity when detectionProbability is 0', () => {
    const result = minimumStake({
      detectionProbability: 0,
      reputationValue: 100,
      maxViolationGain: 500,
      coburn: 50,
    });
    expect(result).toBe(Infinity);
  });

  it('returns 0 when maxViolationGain is 0', () => {
    const result = minimumStake({
      detectionProbability: 0.5,
      reputationValue: 100,
      maxViolationGain: 0,
      coburn: 50,
    });
    expect(result).toBe(0);
  });

  it('scales inversely with detectionProbability', () => {
    const high = minimumStake({
      detectionProbability: 0.9,
      reputationValue: 0,
      maxViolationGain: 900,
      coburn: 0,
    });
    const low = minimumStake({
      detectionProbability: 0.1,
      reputationValue: 0,
      maxViolationGain: 900,
      coburn: 0,
    });
    expect(low).toBeGreaterThan(high);
    expect(high).toBe(1000);
    expect(low).toBe(9000);
  });

  it('throws on negative reputationValue', () => {
    expect(() =>
      minimumStake({
        detectionProbability: 0.5,
        reputationValue: -10,
        maxViolationGain: 400,
        coburn: 50,
      }),
    ).toThrow('reputationValue must be >= 0');
  });

  it('throws on detectionProbability > 1', () => {
    expect(() =>
      minimumStake({
        detectionProbability: 2.0,
        reputationValue: 10,
        maxViolationGain: 400,
        coburn: 50,
      }),
    ).toThrow('detectionProbability must be in [0, 1]');
  });
});

// ---------------------------------------------------------------------------
// minimumDetection
// ---------------------------------------------------------------------------
describe('minimumDetection', () => {
  it('returns correct minimum detection probability', () => {
    // (maxGain - rep - coburn) / stake = (600 - 100 - 0) / 1000 = 0.5
    const result = minimumDetection({
      stakeAmount: 1000,
      reputationValue: 100,
      maxViolationGain: 600,
      coburn: 0,
    });
    expect(result).toBe(0.5);
  });

  it('returns 1 when stakeAmount is 0', () => {
    const result = minimumDetection({
      stakeAmount: 0,
      reputationValue: 100,
      maxViolationGain: 500,
      coburn: 50,
    });
    expect(result).toBe(1);
  });

  it('returns 0 when reputation+coburn exceeds maxGain', () => {
    const result = minimumDetection({
      stakeAmount: 1000,
      reputationValue: 500,
      maxViolationGain: 100,
      coburn: 50,
    });
    expect(result).toBe(0);
  });

  it('clamps to 1 when required detection exceeds 1', () => {
    // (10000 - 0 - 0) / 100 = 100 -> clamped to 1
    const result = minimumDetection({
      stakeAmount: 100,
      reputationValue: 0,
      maxViolationGain: 10000,
      coburn: 0,
    });
    expect(result).toBe(1);
  });

  it('returns 0 when maxViolationGain is 0', () => {
    const result = minimumDetection({
      stakeAmount: 1000,
      reputationValue: 0,
      maxViolationGain: 0,
      coburn: 0,
    });
    expect(result).toBe(0);
  });

  it('throws on negative stakeAmount', () => {
    expect(() =>
      minimumDetection({
        stakeAmount: -100,
        reputationValue: 0,
        maxViolationGain: 500,
        coburn: 0,
      }),
    ).toThrow('stakeAmount must be >= 0');
  });

  it('throws on negative maxViolationGain', () => {
    expect(() =>
      minimumDetection({
        stakeAmount: 100,
        reputationValue: 0,
        maxViolationGain: -10,
        coburn: 0,
      }),
    ).toThrow('maxViolationGain must be >= 0');
  });
});

// ---------------------------------------------------------------------------
// expectedCostOfBreach
// ---------------------------------------------------------------------------
describe('expectedCostOfBreach', () => {
  it('returns stake * detection + coburn', () => {
    const params: HonestyParameters = {
      stakeAmount: 1000,
      detectionProbability: 0.5,
      reputationValue: 100,
      maxViolationGain: 500,
      coburn: 25,
    };
    expect(expectedCostOfBreach(params)).toBe(1000 * 0.5 + 25);
  });

  it('returns 0 when stake and coburn are both 0', () => {
    const params: HonestyParameters = {
      stakeAmount: 0,
      detectionProbability: 0.5,
      reputationValue: 100,
      maxViolationGain: 500,
      coburn: 0,
    };
    expect(expectedCostOfBreach(params)).toBe(0);
  });

  it('returns only coburn when detection is 0', () => {
    const params: HonestyParameters = {
      stakeAmount: 1000,
      detectionProbability: 0,
      reputationValue: 100,
      maxViolationGain: 500,
      coburn: 42,
    };
    expect(expectedCostOfBreach(params)).toBe(42);
  });

  it('returns stake + coburn when detection is 1', () => {
    const params: HonestyParameters = {
      stakeAmount: 500,
      detectionProbability: 1.0,
      reputationValue: 100,
      maxViolationGain: 500,
      coburn: 50,
    };
    expect(expectedCostOfBreach(params)).toBe(550);
  });

  it('throws on invalid parameters', () => {
    expect(() =>
      expectedCostOfBreach({
        stakeAmount: -1,
        detectionProbability: 0.5,
        reputationValue: 0,
        maxViolationGain: 0,
        coburn: 0,
      }),
    ).toThrow('stakeAmount must be >= 0');
  });
});

// ---------------------------------------------------------------------------
// honestyMargin
// ---------------------------------------------------------------------------
describe('honestyMargin', () => {
  it('returns positive margin when honesty dominates', () => {
    const params: HonestyParameters = {
      stakeAmount: 1000,
      detectionProbability: 0.8,
      reputationValue: 500,
      maxViolationGain: 100,
      coburn: 50,
    };
    expect(honestyMargin(params)).toBe(1350 - 100);
  });

  it('returns negative margin when dishonesty dominates', () => {
    const params: HonestyParameters = {
      stakeAmount: 10,
      detectionProbability: 0.1,
      reputationValue: 5,
      maxViolationGain: 1000,
      coburn: 2,
    };
    expect(honestyMargin(params)).toBe(8 - 1000);
  });

  it('returns 0 at exact boundary', () => {
    const params: HonestyParameters = {
      stakeAmount: 100,
      detectionProbability: 0.5,
      reputationValue: 30,
      maxViolationGain: 100,
      coburn: 20,
    };
    expect(honestyMargin(params)).toBeCloseTo(0, 10);
  });

  it('matches proveHonesty margin', () => {
    const params: HonestyParameters = {
      stakeAmount: 750,
      detectionProbability: 0.6,
      reputationValue: 200,
      maxViolationGain: 800,
      coburn: 75,
    };
    const proof = proveHonesty(params);
    expect(honestyMargin(params)).toBe(proof.margin);
  });

  it('works with all-zero parameters', () => {
    const params: HonestyParameters = {
      stakeAmount: 0,
      detectionProbability: 0,
      reputationValue: 0,
      maxViolationGain: 0,
      coburn: 0,
    };
    expect(honestyMargin(params)).toBe(0);
  });

  it('throws on negative coburn', () => {
    expect(() =>
      honestyMargin({
        stakeAmount: 100,
        detectionProbability: 0.5,
        reputationValue: 0,
        maxViolationGain: 0,
        coburn: -5,
      }),
    ).toThrow('coburn must be >= 0');
  });
});

// ---------------------------------------------------------------------------
// repeatedGameEquilibrium (Folk Theorem)
// ---------------------------------------------------------------------------
describe('repeatedGameEquilibrium', () => {
  // Classic Prisoner's Dilemma payoffs: T=5, R=3, P=1, S=0
  const classicPD: RepeatedGameParams = {
    cooperatePayoff: 3,
    defectPayoff: 1,
    temptationPayoff: 5,
    suckerPayoff: 0,
    discountFactor: 0.6,
  };

  it('computes correct minDiscountFactor for classic PD', () => {
    // delta_min = (T - R) / (T - P) = (5 - 3) / (5 - 1) = 0.5
    const result = repeatedGameEquilibrium(classicPD);
    expect(result.minDiscountFactor).toBeCloseTo(0.5, 10);
  });

  it('cooperation is sustainable when delta > threshold', () => {
    // delta = 0.6 > 0.5 = delta_min
    const result = repeatedGameEquilibrium(classicPD);
    expect(result.cooperationSustainable).toBe(true);
    expect(result.margin).toBeCloseTo(0.1, 10);
  });

  it('cooperation is not sustainable when delta < threshold', () => {
    const result = repeatedGameEquilibrium({ ...classicPD, discountFactor: 0.3 });
    expect(result.cooperationSustainable).toBe(false);
    expect(result.margin).toBeCloseTo(-0.2, 10);
  });

  it('cooperation is sustainable at exact threshold (margin = 0)', () => {
    const result = repeatedGameEquilibrium({ ...classicPD, discountFactor: 0.5 });
    expect(result.cooperationSustainable).toBe(true);
    expect(result.margin).toBeCloseTo(0, 10);
  });

  it('formula contains structured derivation text', () => {
    const result = repeatedGameEquilibrium(classicPD);
    expect(result.formula).toContain('Folk Theorem threshold');
    expect(result.formula).toContain('sustainable');
    expect(result.actualDiscountFactor).toBe(0.6);
  });

  it('handles asymmetric payoffs correctly', () => {
    // T=10, R=6, P=2, S=0 => delta_min = (10-6)/(10-2) = 4/8 = 0.5
    const result = repeatedGameEquilibrium({
      cooperatePayoff: 6,
      defectPayoff: 2,
      temptationPayoff: 10,
      suckerPayoff: 0,
      discountFactor: 0.75,
    });
    expect(result.minDiscountFactor).toBeCloseTo(0.5, 10);
    expect(result.cooperationSustainable).toBe(true);
  });

  it('throws on invalid payoff ordering (T <= R)', () => {
    expect(() =>
      repeatedGameEquilibrium({
        cooperatePayoff: 5,
        defectPayoff: 1,
        temptationPayoff: 3, // T < R
        suckerPayoff: 0,
        discountFactor: 0.5,
      }),
    ).toThrow('temptationPayoff (3) must be > cooperatePayoff (5)');
  });

  it('throws on invalid payoff ordering (R <= P)', () => {
    expect(() =>
      repeatedGameEquilibrium({
        cooperatePayoff: 1,
        defectPayoff: 3, // P > R
        temptationPayoff: 5,
        suckerPayoff: 0,
        discountFactor: 0.5,
      }),
    ).toThrow('cooperatePayoff (1) must be > defectPayoff (3)');
  });

  it('throws on invalid payoff ordering (P <= S)', () => {
    expect(() =>
      repeatedGameEquilibrium({
        cooperatePayoff: 3,
        defectPayoff: 0, // P <= S
        temptationPayoff: 5,
        suckerPayoff: 0,
        discountFactor: 0.5,
      }),
    ).toThrow('defectPayoff (0) must be > suckerPayoff (0)');
  });

  it('throws on discount factor out of range (0)', () => {
    expect(() =>
      repeatedGameEquilibrium({ ...classicPD, discountFactor: 0 }),
    ).toThrow('discountFactor must be in (0, 1)');
  });

  it('throws on discount factor out of range (1)', () => {
    expect(() =>
      repeatedGameEquilibrium({ ...classicPD, discountFactor: 1 }),
    ).toThrow('discountFactor must be in (0, 1)');
  });

  it('higher temptation requires higher discount factor', () => {
    const lowTemptation = repeatedGameEquilibrium({
      cooperatePayoff: 3,
      defectPayoff: 1,
      temptationPayoff: 4,
      suckerPayoff: 0,
      discountFactor: 0.5,
    });
    const highTemptation = repeatedGameEquilibrium({
      cooperatePayoff: 3,
      defectPayoff: 1,
      temptationPayoff: 8,
      suckerPayoff: 0,
      discountFactor: 0.5,
    });
    expect(highTemptation.minDiscountFactor).toBeGreaterThan(lowTemptation.minDiscountFactor);
  });
});

// ---------------------------------------------------------------------------
// coalitionStability (Core of Cooperative Game Theory)
// ---------------------------------------------------------------------------
describe('coalitionStability', () => {
  it('identifies stable allocation in the core', () => {
    // 3-player game: v({0})=0, v({1})=0, v({2})=0
    // v({0,1})=4, v({0,2})=3, v({1,2})=5, v({0,1,2})=10
    // Allocation: [3, 4, 3] => sum = 10
    // Check: {0,1}=7 >= 4 ok, {0,2}=6 >= 3 ok, {1,2}=7 >= 5 ok
    const coalitionValues: CoalitionValue[] = [
      { coalition: [0], value: 0 },
      { coalition: [1], value: 0 },
      { coalition: [2], value: 0 },
      { coalition: [0, 1], value: 4 },
      { coalition: [0, 2], value: 3 },
      { coalition: [1, 2], value: 5 },
      { coalition: [0, 1, 2], value: 10 },
    ];
    const result = coalitionStability(3, [3, 4, 3], coalitionValues);
    expect(result.isStable).toBe(true);
    expect(result.blockingCoalitions).toHaveLength(0);
  });

  it('identifies unstable allocation with blocking coalitions', () => {
    // Same game, bad allocation: [1, 1, 8]
    // {0,1} allocated=2 < v({0,1})=4 => blocks!
    const coalitionValues: CoalitionValue[] = [
      { coalition: [0], value: 0 },
      { coalition: [1], value: 0 },
      { coalition: [2], value: 0 },
      { coalition: [0, 1], value: 4 },
      { coalition: [0, 2], value: 3 },
      { coalition: [1, 2], value: 5 },
      { coalition: [0, 1, 2], value: 10 },
    ];
    const result = coalitionStability(3, [1, 1, 8], coalitionValues);
    expect(result.isStable).toBe(false);
    expect(result.blockingCoalitions.length).toBeGreaterThan(0);
    // {0,1} should be a blocking coalition
    const blocking01 = result.blockingCoalitions.find(
      bc => bc.coalition.length === 2 && bc.coalition[0] === 0 && bc.coalition[1] === 1,
    );
    expect(blocking01).toBeDefined();
    expect(blocking01!.surplus).toBeCloseTo(2, 10);
  });

  it('computes efficiency correctly', () => {
    const coalitionValues: CoalitionValue[] = [
      { coalition: [0, 1], value: 10 },
    ];
    // allocation sums to 10, grand coalition = 10 => efficiency = 1.0
    const result = coalitionStability(2, [4, 6], coalitionValues);
    expect(result.efficiency).toBeCloseTo(1.0, 10);
  });

  it('handles 2-player game', () => {
    // v({0})=3, v({1})=4, v({0,1})=10
    // Allocation [5,5]: {0}=5>=3 ok, {1}=5>=4 ok => stable
    const result = coalitionStability(2, [5, 5], [
      { coalition: [0], value: 3 },
      { coalition: [1], value: 4 },
      { coalition: [0, 1], value: 10 },
    ]);
    expect(result.isStable).toBe(true);
  });

  it('2-player game with blocking singleton', () => {
    // v({0})=6, v({1})=4, v({0,1})=10
    // Allocation [4,6]: agent 0 gets 4 < v({0})=6 => blocks
    const result = coalitionStability(2, [4, 6], [
      { coalition: [0], value: 6 },
      { coalition: [1], value: 4 },
      { coalition: [0, 1], value: 10 },
    ]);
    expect(result.isStable).toBe(false);
    expect(result.blockingCoalitions[0].coalition).toEqual([0]);
  });

  it('formula contains derivation for stable case', () => {
    const result = coalitionStability(2, [5, 5], [
      { coalition: [0], value: 3 },
      { coalition: [1], value: 4 },
      { coalition: [0, 1], value: 10 },
    ]);
    expect(result.formula).toContain('in the core');
  });

  it('formula contains derivation for unstable case', () => {
    const result = coalitionStability(2, [2, 8], [
      { coalition: [0], value: 5 },
      { coalition: [1], value: 3 },
      { coalition: [0, 1], value: 10 },
    ]);
    expect(result.formula).toContain('NOT in the core');
    expect(result.formula).toContain('blocking');
  });

  it('throws on agentCount < 1', () => {
    expect(() => coalitionStability(0, [], [])).toThrow('agentCount must be >= 1');
  });

  it('throws on allocation length mismatch', () => {
    expect(() =>
      coalitionStability(3, [1, 2], [{ coalition: [0, 1, 2], value: 10 }]),
    ).toThrow('allocation length (2) must equal agentCount (3)');
  });

  it('throws when grand coalition is missing', () => {
    expect(() =>
      coalitionStability(2, [5, 5], [{ coalition: [0], value: 3 }]),
    ).toThrow('coalitionValues must include the grand coalition');
  });

  it('defaults unspecified coalition values to 0', () => {
    // Only specify grand coalition; all subsets default to 0
    // Any positive allocation should be stable
    const result = coalitionStability(2, [5, 5], [
      { coalition: [0, 1], value: 10 },
    ]);
    expect(result.isStable).toBe(true);
  });

  it('handles single-agent game (trivially stable)', () => {
    const result = coalitionStability(1, [10], [
      { coalition: [0], value: 10 },
    ]);
    expect(result.isStable).toBe(true);
    expect(result.efficiency).toBeCloseTo(1.0, 10);
  });
});

// ---------------------------------------------------------------------------
// mechanismDesign (Incentive Compatibility)
// ---------------------------------------------------------------------------
describe('mechanismDesign', () => {
  it('computes correct minimum penalty', () => {
    // penalty_min = dishonestGain / detectionProbability = 100 / 0.5 = 200
    const result = mechanismDesign({
      dishonestGain: 100,
      detectionProbability: 0.5,
    });
    expect(result.minimumPenalty).toBeCloseTo(200, 10);
    expect(result.enforceable).toBe(true);
  });

  it('accounts for intrinsic honesty cost', () => {
    // penalty_min = (100 - 30) / 0.5 = 140
    const result = mechanismDesign({
      dishonestGain: 100,
      detectionProbability: 0.5,
      intrinsicHonestyCost: 30,
    });
    expect(result.minimumPenalty).toBeCloseTo(140, 10);
  });

  it('returns 0 penalty when intrinsic cost exceeds gain', () => {
    const result = mechanismDesign({
      dishonestGain: 50,
      detectionProbability: 0.5,
      intrinsicHonestyCost: 100,
    });
    expect(result.minimumPenalty).toBe(0);
    expect(result.enforceable).toBe(true);
    expect(result.formula).toContain('No penalty needed');
  });

  it('returns Infinity when detection is 0 and gain > intrinsic cost', () => {
    const result = mechanismDesign({
      dishonestGain: 100,
      detectionProbability: 0,
    });
    expect(result.minimumPenalty).toBe(Infinity);
    expect(result.enforceable).toBe(false);
    expect(result.formula).toContain('No finite penalty');
  });

  it('enforceable when detection is 0 but intrinsic cost covers gain', () => {
    const result = mechanismDesign({
      dishonestGain: 50,
      detectionProbability: 0,
      intrinsicHonestyCost: 60,
    });
    expect(result.minimumPenalty).toBe(0);
    expect(result.enforceable).toBe(true);
  });

  it('expected penalty equals dishonest gain at minimum penalty', () => {
    const result = mechanismDesign({
      dishonestGain: 100,
      detectionProbability: 0.5,
    });
    // expectedPenalty = 200 * 0.5 = 100 = dishonestGain
    expect(result.expectedPenalty).toBeCloseTo(100, 10);
  });

  it('penalty scales inversely with detection probability', () => {
    const high = mechanismDesign({ dishonestGain: 100, detectionProbability: 0.8 });
    const low = mechanismDesign({ dishonestGain: 100, detectionProbability: 0.2 });
    expect(low.minimumPenalty).toBeGreaterThan(high.minimumPenalty);
    expect(high.minimumPenalty).toBeCloseTo(125, 10);
    expect(low.minimumPenalty).toBeCloseTo(500, 10);
  });

  it('formula contains incentive compatibility constraint', () => {
    const result = mechanismDesign({
      dishonestGain: 100,
      detectionProbability: 0.5,
    });
    expect(result.formula).toContain('Incentive compatibility');
    expect(result.formula).toContain('penalty');
  });

  it('throws on negative dishonestGain', () => {
    expect(() =>
      mechanismDesign({ dishonestGain: -10, detectionProbability: 0.5 }),
    ).toThrow('dishonestGain must be >= 0');
  });

  it('throws on detectionProbability out of range', () => {
    expect(() =>
      mechanismDesign({ dishonestGain: 100, detectionProbability: 1.5 }),
    ).toThrow('detectionProbability must be in [0, 1]');
    expect(() =>
      mechanismDesign({ dishonestGain: 100, detectionProbability: -0.1 }),
    ).toThrow('detectionProbability must be in [0, 1]');
  });

  it('throws on negative intrinsicHonestyCost', () => {
    expect(() =>
      mechanismDesign({
        dishonestGain: 100,
        detectionProbability: 0.5,
        intrinsicHonestyCost: -10,
      }),
    ).toThrow('intrinsicHonestyCost must be >= 0');
  });

  it('handles zero dishonest gain (no penalty needed)', () => {
    const result = mechanismDesign({
      dishonestGain: 0,
      detectionProbability: 0.5,
    });
    expect(result.minimumPenalty).toBe(0);
    expect(result.enforceable).toBe(true);
  });

  it('handles perfect detection (penalty = gain)', () => {
    const result = mechanismDesign({
      dishonestGain: 100,
      detectionProbability: 1.0,
    });
    expect(result.minimumPenalty).toBeCloseTo(100, 10);
  });
});
