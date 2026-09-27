"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { Hercules } from "@usehercules/sdk";
import { api, internal } from "./_generated/api";

const hercules = new Hercules({
  apiKey: process.env.HERCULES_API_KEY,
  apiVersion: "2025-12-09",
});

export const createCheckout = action({
  args: {
    variantId: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string | null | undefined }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
    if (!user) throw new Error("Not authenticated");

    let customerId = user.customerId;
    if (!customerId) {
      const customer = await hercules.commerce.customers.create({
        name: user.name ?? "AdSpy Pro User",
        email: user.email ?? undefined,
      });
      customerId = customer.id;
      await ctx.runMutation(internal.users.updateCustomerIdInternal, { customerId });
    }

    const session = await hercules.commerce.checkout({
      customer_id: customerId,
      line_items: [{ variant_id: args.variantId, quantity: 1 }],
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      trial_period_days: 7,
    });

    return { url: session.url };
  },
});

export const getBillingPortal = action({
  args: { returnUrl: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
    if (!user?.customerId) throw new Error("No billing account found");
    const portal = await hercules.commerce.customers.billingPortal(user.customerId, {
      return_url: args.returnUrl,
    });
    return { url: portal.url };
  },
});

export const checkAccess = action({
  args: { featureId: v.string() },
  handler: async (ctx, args): Promise<{ hasAccess: boolean; plan: string }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
    if (!user) return { hasAccess: false, plan: "none" };

    // Admins get full access without going through real billing.
    if (user.role === "admin") return { hasAccess: true, plan: "agency" };

    if (!user.customerId) return { hasAccess: false, plan: "none" };

    // Check agency first (highest tier)
    const agency = await hercules.commerce.check({
      customer_id: user.customerId,
      resource_id: "feat_agency",
    });
    if (agency.has_access) return { hasAccess: true, plan: "agency" };

    const pro = await hercules.commerce.check({
      customer_id: user.customerId,
      resource_id: "feat_pro",
    });
    if (pro.has_access) return { hasAccess: true, plan: "pro" };

    const starter = await hercules.commerce.check({
      customer_id: user.customerId,
      resource_id: "feat_starter",
    });
    if (starter.has_access) return { hasAccess: true, plan: "starter" };

    return { hasAccess: false, plan: "none" };
  },
});

export const getUserPlan = action({
  args: {},
  handler: async (ctx): Promise<{ plan: "agency" | "pro" | "starter" | "none" }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
    if (!user) return { plan: "none" };

    // Admins get full (agency-tier) access without going through real billing.
    if (user.role === "admin") return { plan: "agency" };

    if (!user.customerId) return { plan: "none" };

    const agency = await hercules.commerce.check({ customer_id: user.customerId, resource_id: "feat_agency" });
    if (agency.has_access) return { plan: "agency" };

    const pro = await hercules.commerce.check({ customer_id: user.customerId, resource_id: "feat_pro" });
    if (pro.has_access) return { plan: "pro" };

    const starter = await hercules.commerce.check({ customer_id: user.customerId, resource_id: "feat_starter" });
    if (starter.has_access) return { plan: "starter" };

    return { plan: "none" };
  },
});

// Admin: look up a specific user's plan by their customerId. Requires admin role.
export const getCustomerPlanForAdmin = action({
  args: { customerId: v.string() },
  handler: async (ctx, args): Promise<{ plan: "agency" | "pro" | "starter" | "none" }> => {
    const isAdmin: boolean = await ctx.runQuery(api.users.isAdmin);
    if (!isAdmin) throw new Error("Admin access required");

    const agency = await hercules.commerce.check({ customer_id: args.customerId, resource_id: "feat_agency" });
    if (agency.has_access) return { plan: "agency" };

    const pro = await hercules.commerce.check({ customer_id: args.customerId, resource_id: "feat_pro" });
    if (pro.has_access) return { plan: "pro" };

    const starter = await hercules.commerce.check({ customer_id: args.customerId, resource_id: "feat_starter" });
    if (starter.has_access) return { plan: "starter" };

    return { plan: "none" };
  },
});
