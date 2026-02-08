export interface HonestyParameters {
  stakeAmount: number;
  detectionProbability: number;
  reputationValue: number;
  maxViolationGain: number;
  coburn: number;
}

export interface HonestyProof {
  isDominantStrategy: boolean;
  margin: number;
  requiredStake: number;
  requiredDetection: number;
  formula: string;
}
