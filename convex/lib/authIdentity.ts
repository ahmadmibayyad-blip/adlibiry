import type { UserIdentity } from "convex/server";

// Convex Auth identities look like subject = "<userId>|<sessionId>", so the raw
// tokenIdentifier changes on every sign-in. The app stores the userId part as
// users.tokenIdentifier (set in auth.ts) and looks users up with this key.
export function stableToken(identity: UserIdentity): string {
  return identity.subject.split("|")[0];
}
