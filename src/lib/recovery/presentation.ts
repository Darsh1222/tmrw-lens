import type { Obstacle, Proposal, RecoveryResult } from "./engine";
/** Prefer the option that answers the selected obstacle; never manufacture an option that did not pass checks. */
export function preferredProposal(result: RecoveryResult, obstacle: Obstacle): Proposal | undefined {
  const id = obstacle === "tired" ? "tomorrow" : obstacle === "stuck" ? "starter" : "balanced";
  return result.proposals.find((p) => p.id === id) ?? result.proposals[0];
}
