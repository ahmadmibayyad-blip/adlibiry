import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// Istilam for Shopify: the WhatsApp half of the COD flow.

export const sendConfirm = internalAction({
  args: { shopKey: v.string(), orderId: v.string(), reminder: v.number() },
  handler: async () => {},
});
