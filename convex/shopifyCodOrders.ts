import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { gql } from "./shopifyCodAuth";
import { errorText } from "./sallaOrders";

// Istilam for Shopify: a new COD order's fulfillment orders go on hold (handle "istilam", so we
// only ever release our own holds) and get the tag istilam:pending while the customer is asked on
// WhatsApp (shopifyCodWhatsapp.ts). Confirm releases the hold; cancel cancels the order with
// restock and no refund (nothing was paid); a new address is added to the order note.

export const HOLD_NOTE = "Istilam: waiting for the customer's WhatsApp confirmation";
const HOLD_HANDLE = "istilam";
const FO_WAIT_MS = 60 * 1000; // Shopify can create the fulfillment orders a moment after orders/create
const TAG = { pending: "istilam:pending", confirmed: "istilam:confirmed", cancelled: "istilam:cancelled", address: "istilam:address" };

const orderGid = (id: string) => `gid://shopify/Order/${id}`;
type UserErrors = { message: string }[] | undefined;

function check(errors: UserErrors) {
  if (errors?.length) throw new Error(`Shopify: ${errors.map((e) => e.message).join("; ")}`.slice(0, 300));
}

export const order = internalQuery({
  args: { shopKey: v.string(), orderId: v.string() },
  handler: (ctx, { shopKey, orderId }) =>
    ctx.db.query("shopifyCodOrders").withIndex("by_shop_order", (q) => q.eq("shopKey", shopKey).eq("orderId", orderId)).unique(),
});

export const recordOrder = internalMutation({
  args: {
    shopKey: v.string(), orderId: v.string(),
    lastError: v.optional(v.string()), heldAt: v.optional(v.number()), decidedAt: v.optional(v.number()),
    fulfillmentOrderIds: v.optional(v.array(v.string())), releasedOutside: v.optional(v.boolean()), status: v.optional(v.string()),
  },
  handler: async (ctx, { shopKey, orderId, ...patch }) => {
    const o = await ctx.db.query("shopifyCodOrders").withIndex("by_shop_order", (q) => q.eq("shopKey", shopKey).eq("orderId", orderId)).unique();
    if (o) await ctx.db.patch("shopifyCodOrders", o._id, patch);
  },
});

const tags = (ctx: ActionCtx, shopKey: string, orderId: string, op: "add" | "remove", list: string[]) =>
  op === "add"
    ? gql<{ tagsAdd?: { userErrors: UserErrors } }>(ctx, shopKey,
      `mutation IstilamTagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`,
      { id: orderGid(orderId), tags: list }).then((r) => check(r.tagsAdd?.userErrors))
    : gql<{ tagsRemove?: { userErrors: UserErrors } }>(ctx, shopKey,
      `mutation IstilamTagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`,
      { id: orderGid(orderId), tags: list }).then((r) => check(r.tagsRemove?.userErrors));

/** Releases the holds Istilam placed; false when none were left (the merchant released them). */
async function releaseOurs(ctx: ActionCtx, shopKey: string, orderId: string): Promise<boolean> {
  type Holds = { order?: { fulfillmentOrders?: { nodes: { id: string; fulfillmentHolds?: { id: string; heldByRequestingApp: boolean }[] }[] } } | null };
  const r = await gql<Holds>(ctx, shopKey,
    `query IstilamHolds($id: ID!) { order(id: $id) { fulfillmentOrders(first: 10) { nodes { id status fulfillmentHolds { id heldByRequestingApp } } } } }`,
    { id: orderGid(orderId) });
  let released = false;
  for (const fo of r.order?.fulfillmentOrders?.nodes ?? []) {
    const holdIds = (fo.fulfillmentHolds ?? []).filter((h) => h.heldByRequestingApp).map((h) => h.id);
    if (!holdIds.length) continue;
    const res = await gql<{ fulfillmentOrderReleaseHold?: { userErrors: UserErrors } }>(ctx, shopKey,
      `mutation IstilamRelease($id: ID!, $holdIds: [ID!]) { fulfillmentOrderReleaseHold(id: $id, holdIds: $holdIds) { userErrors { message } } }`,
      { id: fo.id, holdIds });
    check(res.fulfillmentOrderReleaseHold?.userErrors);
    released = true;
  }
  return released;
}

export const hold = internalAction({
  args: { shopKey: v.string(), orderId: v.string(), attempt: v.optional(v.number()) },
  handler: async (ctx, { shopKey, orderId, attempt }): Promise<void> => {
    const o = await ctx.runQuery(internal.shopifyCodOrders.order, { shopKey, orderId });
    if (!o || o.status !== "pending") return;
    try {
      type ForHold = { order?: { cancelledAt: string | null; fulfillmentOrders?: { nodes: { id: string; status: string }[] } } | null };
      const r = await gql<ForHold>(ctx, shopKey,
        `query IstilamOrderForHold($id: ID!) { order(id: $id) { cancelledAt fulfillmentOrders(first: 10) { nodes { id status } } } }`,
        { id: orderGid(orderId) });
      if (!r.order || r.order.cancelledAt) {
        await ctx.runMutation(internal.shopifyCodOrders.recordOrder, { shopKey, orderId, status: "cancelled", decidedAt: Date.now() });
        return;
      }
      const open = (r.order.fulfillmentOrders?.nodes ?? []).filter((fo) => fo.status === "OPEN" || fo.status === "ON_HOLD" || fo.status === "SCHEDULED");
      if (!open.length) {
        if (!attempt) {
          await ctx.scheduler.runAfter(FO_WAIT_MS, internal.shopifyCodOrders.hold, { shopKey, orderId, attempt: 1 });
          return;
        }
        throw new Error("no_fulfillment_order: Shopify had no open fulfillment order to hold");
      }
      for (const fo of open) {
        const res = await gql<{ fulfillmentOrderHold?: { userErrors: UserErrors } }>(ctx, shopKey,
          `mutation IstilamHold($id: ID!, $hold: FulfillmentOrderHoldInput!) { fulfillmentOrderHold(id: $id, fulfillmentHold: $hold) { userErrors { message } } }`,
          { id: fo.id, hold: { reason: "OTHER", reasonNotes: HOLD_NOTE, handle: HOLD_HANDLE } });
        check(res.fulfillmentOrderHold?.userErrors);
      }
      await tags(ctx, shopKey, orderId, "add", [TAG.pending]);
      await ctx.runMutation(internal.shopifyCodOrders.recordOrder, { shopKey, orderId, heldAt: Date.now(), fulfillmentOrderIds: open.map((fo) => fo.id) });
    } catch (e) {
      // Not held, but the customer is still asked: the merchant sees the error and can hold by hand.
      await ctx.runMutation(internal.shopifyCodOrders.recordOrder, { shopKey, orderId, lastError: errorText(e) });
    }
    await ctx.scheduler.runAfter(0, internal.shopifyCodWhatsapp.sendConfirm, { shopKey, orderId, reminder: 0 });
  },
});

export const decide = internalAction({
  args: { shopKey: v.string(), orderId: v.string(), decision: v.union(v.literal("confirmed"), v.literal("cancelled")), note: v.optional(v.string()) },
  handler: async (ctx, { shopKey, orderId, decision, note }): Promise<void> => {
    try {
      if (decision === "confirmed") {
        const released = await releaseOurs(ctx, shopKey, orderId);
        await tags(ctx, shopKey, orderId, "add", [TAG.confirmed]);
        await tags(ctx, shopKey, orderId, "remove", [TAG.pending]);
        await ctx.runMutation(internal.shopifyCodOrders.recordOrder, {
          shopKey, orderId, decidedAt: Date.now(), lastError: undefined, ...(released ? {} : { releasedOutside: true }),
        });
      } else {
        type Cancel = { orderCancel?: { userErrors: UserErrors; orderCancelUserErrors: UserErrors } };
        const r = await gql<Cancel>(ctx, shopKey,
          `mutation IstilamCancel($orderId: ID!, $reason: OrderCancelReason!, $restock: Boolean!, $notifyCustomer: Boolean, $refundMethod: OrderCancelRefundMethodInput, $staffNote: String) {
            orderCancel(orderId: $orderId, reason: $reason, restock: $restock, notifyCustomer: $notifyCustomer, refundMethod: $refundMethod, staffNote: $staffNote) {
              userErrors { message } orderCancelUserErrors { message } } }`,
          {
            orderId: orderGid(orderId), reason: "CUSTOMER", restock: true, notifyCustomer: false,
            refundMethod: { originalPaymentMethodsRefund: false }, ...(note ? { staffNote: note.slice(0, 255) } : {}),
          });
        check(r.orderCancel?.userErrors);
        check(r.orderCancel?.orderCancelUserErrors);
        await tags(ctx, shopKey, orderId, "add", [TAG.cancelled]);
        await tags(ctx, shopKey, orderId, "remove", [TAG.pending]);
        await ctx.runMutation(internal.shopifyCodOrders.recordOrder, { shopKey, orderId, decidedAt: Date.now(), lastError: undefined });
      }
    } catch (e) {
      await ctx.runMutation(internal.shopifyCodOrders.recordOrder, { shopKey, orderId, lastError: errorText(e) });
    }
  },
});

/** The customer can't be asked (no usable number): let the order ship as usual. */
export const releaseHold = internalAction({
  args: { shopKey: v.string(), orderId: v.string() },
  handler: async (ctx, { shopKey, orderId }): Promise<void> => {
    try {
      await releaseOurs(ctx, shopKey, orderId);
      await tags(ctx, shopKey, orderId, "remove", [TAG.pending]);
    } catch (e) {
      await ctx.runMutation(internal.shopifyCodOrders.recordOrder, { shopKey, orderId, lastError: errorText(e) });
    }
  },
});

/** Adds a line (the customer's new address) to the order note and tags the order. */
export const appendNote = internalAction({
  args: { shopKey: v.string(), orderId: v.string(), line: v.string() },
  handler: async (ctx, { shopKey, orderId, line }): Promise<void> => {
    try {
      const r = await gql<{ order?: { note: string | null } | null }>(ctx, shopKey,
        `query IstilamNote($id: ID!) { order(id: $id) { note } }`, { id: orderGid(orderId) });
      const old = r.order?.note?.trim();
      const res = await gql<{ orderUpdate?: { userErrors: UserErrors } }>(ctx, shopKey,
        `mutation IstilamNoteUpdate($input: OrderInput!) { orderUpdate(input: $input) { userErrors { message } } }`,
        { input: { id: orderGid(orderId), note: old ? `${old}\n${line}` : line } });
      check(res.orderUpdate?.userErrors);
      await tags(ctx, shopKey, orderId, "add", [TAG.address]);
    } catch (e) {
      await ctx.runMutation(internal.shopifyCodOrders.recordOrder, { shopKey, orderId, lastError: errorText(e) });
    }
  },
});
