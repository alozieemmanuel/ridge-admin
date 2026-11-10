/** Settings rows of the automatic invitation. They have their own switch on the Attendance page, so the generic settings form leaves them out. */
export const AUTO_INVITE_KEY = "auto_invite";
export const AUTO_INVITE_SINCE_KEY = "auto_invite_since";
export const AUTO_INVITE_LAST_KEY = "auto_invite_last";
export const AUTO_INVITE_KEYS = [AUTO_INVITE_KEY, AUTO_INVITE_SINCE_KEY, AUTO_INVITE_LAST_KEY];
/** One row per person waiting for the automatic invitation: "auto_invite_new:<registration id>". */
export const AUTO_INVITE_NEW_PREFIX = "auto_invite_new:";
export function isAutoInviteKey(key: string): boolean {
  return AUTO_INVITE_KEYS.includes(key) || key.startsWith(AUTO_INVITE_NEW_PREFIX);
}
