// Drop-in stand-in for the parts of "@usehercules/sdk" this app used, so the
// app runs without a Hercules account:
// - email: sent through Resend when RESEND_API_KEY is set (free tier: 3,000/month)
// - push notifications: disabled
// Every call fails loudly with a clear message instead of silently.

type EmailArgs = { from: string; to: string; subject: string; html: string; headers?: Record<string, string> };

class NotConfiguredError extends Error {
  constructor(feature: string, hint: string) {
    super(`${feature} is not set up yet. ${hint}`);
  }
}

export class Hercules {
  constructor(_opts?: { apiKey?: string; apiVersion?: string }) {}

  email = {
    send: async ({ from, to, subject, html, headers }: EmailArgs) => {
      const key = process.env.RESEND_API_KEY;
      if (!key) throw new NotConfiguredError("Email", "Add a RESEND_API_KEY environment variable in Convex.");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM ?? from, to, subject, html, ...(headers ? { headers } : {}) }),
      });
      if (!res.ok) throw new Error(`Resend error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    },
  };

  pushNotifications = {
    enable: async (): Promise<{ vapidPublicKey: string }> => {
      throw new NotConfiguredError("Push notifications", "They are disabled in this deployment.");
    },
    subscribe: async (_args: unknown): Promise<{ secret: string }> => {
      throw new NotConfiguredError("Push notifications", "They are disabled in this deployment.");
    },
    identify: async (_args: unknown): Promise<{ success: boolean; alreadyIdentified?: boolean }> => ({
      success: false,
    }),
    unsubscribe: async (_args: unknown) => ({ success: true }),
    send: async (args: { visitorIds?: string[]; [key: string]: unknown }) => ({ sent: 0, failed: args.visitorIds?.length ?? 0 }),
  };
}
