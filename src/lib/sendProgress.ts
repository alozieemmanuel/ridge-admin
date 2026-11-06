/**
 * What a campaign send reports while it runs, so the Campaigns page can show real progress instead of a spinner.
 * The Mailchimp send route streams one JSON object per line (progress, then done or error).
 */

export type SendStage = "audience" | "adding" | "retrying" | "campaign" | "sending" | "saving";

export interface SendProgress {
  stage: SendStage;
  /** One plain sentence about what is happening right now. */
  message: string;
  /** How far along this stage is (for example guests added so far), when it can be counted. */
  done?: number;
  total?: number;
}

export type SendEvent = { type: "progress"; progress: SendProgress } | { type: "done"; result: unknown } | { type: "error"; error: string };

/** The steps shown to the admin, in order, and which stages belong to each. */
export const SEND_STEPS: { label: string; stages: SendStage[] }[] = [
  { label: "Checking who is subscribed in Mailchimp", stages: ["audience"] },
  { label: "Adding guests to the audience", stages: ["adding", "retrying"] },
  { label: "Creating the campaign", stages: ["campaign"] },
  { label: "Sending", stages: ["sending"] },
  { label: "Saving the results", stages: ["saving"] },
];

/** Overall progress, 0 to 100, from the stage and how far along it is. */
export function sendPercent(p: SendProgress): number {
  const fraction = p.total && p.total > 0 ? Math.min(1, (p.done ?? 0) / p.total) : 0;
  switch (p.stage) {
    case "audience":
      return Math.round(2 + fraction * 13);
    case "adding":
    case "retrying":
      return Math.round(15 + fraction * 45);
    case "campaign":
      return 65;
    case "sending":
      return 85;
    case "saving":
      return 95;
  }
}
