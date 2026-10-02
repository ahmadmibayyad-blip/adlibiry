import { query } from "./_generated/server";

// Which sign-in options the login page shows. Read on every call (not at
// module load) so adding the Google keys shows the button without a deploy.
export const get = query({
  args: {},
  handler: async () => ({
    google: !!(process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim()),
  }),
});
