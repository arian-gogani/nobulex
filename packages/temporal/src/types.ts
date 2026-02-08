export type TriggerType = 'capability_change' | 'time_elapsed' | 'reputation_threshold' | 'breach_event' | 'governance_vote';
export type TriggerAction = 'tighten' | 'relax' | 'add_constraint' | 'remove_constraint';

export interface EvolutionPolicy {
  covenantId: string;
  triggers: EvolutionTrigger[];
  transitions: TransitionFunction[];
  governanceApproval: boolean;
}

export interface EvolutionTrigger {
  type: TriggerType;
  condition: string;
  action: TriggerAction;
  constraintId?: string;
}

export interface TransitionFunction {
  fromConstraint: string;
  toConstraint: string;
  trigger: string;
  reversible: boolean;
  cooldown: number;
}

export interface EvolutionEvent {
  covenantId: string;
  trigger: EvolutionTrigger;
  previousConstraints: string[];
  newConstraints: string[];
  timestamp: number;
  approved: boolean;
}

export interface AgentState {
  reputationScore: number;
  capabilities: string[];
  breachCount: number;
  lastBreachAt?: number;
  currentTime: number;
  governanceVotes?: Record<string, boolean>;
}

export interface CovenantState {
  id: string;
  constraints: string[];
  policy?: EvolutionPolicy;
  history: EvolutionEvent[];
  lastTransitionAt?: number;
}
