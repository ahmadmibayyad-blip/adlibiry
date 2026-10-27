import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// Istilam for Shopify: putting COD orders on hold and acting on the customer's answer.

export const hold = internalAction({
  args: { shopKey: v.string(), orderId: v.string(), attempt: v.optional(v.number()) },
  handler: async () => {},
});
