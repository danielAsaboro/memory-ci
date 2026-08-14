import { DomainError } from "./errors";
import type { CandidateState } from "./types";

export type CandidateEvent =
  | "begin_screening"
  | "screening_passed"
  | "begin_evaluation"
  | "evaluation_passed"
  | "request_review"
  | "approve"
  | "reject"
  | "activate"
  | "quarantine"
  | "supersede"
  | "roll_back"
  | "expire"
  | "provider_failed";

const transitions = {
  proposed: {
    begin_screening: "screening",
    quarantine: "quarantined",
    reject: "rejected",
  },
  screening: {
    screening_passed: "evaluating",
    begin_evaluation: "evaluating",
    quarantine: "quarantined",
    reject: "rejected",
    provider_failed: "failed",
  },
  evaluating: {
    evaluation_passed: "review_required",
    request_review: "review_required",
    quarantine: "quarantined",
    reject: "rejected",
    provider_failed: "failed",
  },
  review_required: {
    approve: "approved",
    reject: "rejected",
    quarantine: "quarantined",
  },
  approved: {
    activate: "active",
    reject: "rejected",
  },
  active: {
    supersede: "superseded",
    roll_back: "rolled_back",
    expire: "expired",
  },
  quarantined: {},
  rejected: {},
  superseded: {},
  rolled_back: {},
  expired: {},
  failed: {},
} as const satisfies Record<CandidateState, Partial<Record<CandidateEvent, CandidateState>>>;

export function transitionCandidate(state: CandidateState, event: CandidateEvent): CandidateState {
  const next = transitions[state][event as keyof (typeof transitions)[typeof state]] as CandidateState | undefined;

  if (!next) {
    throw new DomainError("invalid_transition", `Cannot apply ${event} while candidate is ${state}.`, {
      state,
      event,
    });
  }

  return next;
}
