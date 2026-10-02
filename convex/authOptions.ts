import { query } from "./_generated/server";
import { googleEnabled } from "./auth";

// Which sign-in options the login page shows.
export const get = query({
  args: {},
  handler: async () => ({ google: googleEnabled }),
});
