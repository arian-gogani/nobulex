import { describe, it, expect } from 'vitest';
import {
  proveHonesty,
  minimumStake,
  minimumDetection,
  expectedCostOfBreach,
  honestyMargin,
  validateParameters,
} from './index';
import type { HonestyParameters } from './types';

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
