"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { v } from "convex/values";
import * as z from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { claudeClient } from "./lib/claudeClient";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { LAUNCH_SYSTEM, cleanCopy, launchFacts, launchProductInput, type LaunchCopy } from "./lib/launchCopy";
import { decryptToken } from "./lib/shopifyOAuth";
import { SHOPIFY_API_VERSION } from "./lib/shopifyExport";

// The Launch job (convex/launch.ts start): Claude writes the page and ad kit
// from the product's facts and its winning ads, the claim rules clean it, and
// it's created in the user's store with productSet (and put on the Online
// Store when published as active). Progress and errors land on the launch row.

const MODEL = "claude-opus-5-5";

// No min/max in the schema (structured output); lengths are enforced in cleanCopy.
const CopySchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  benefits: z.array(z.string()),
  hook: z.string(),
  howItWorks: z.array(z.string()),
  whatsIncluded: z.array(z.string()),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  shippingReturns: z.string(),
  seo: z.object({ title: z.string(), description: z.string() }),
  adKit: z.array(z.object({ angle: z.string(), hook: z.string(), primaryText: z.string(), headline: z.string() })),
});

type Gql = { data?: Record<string, unknown>; errors?: { message: string }[] | string };

async function shopify(shop: string, token: string, query: string, variables?: Record<string, unknown>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // Shopify rate limit or hiccup: wait and retry
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as Gql;
    if (res.status === 401 || res.status === 403) throw new Error("Shopify refused access. Reconnect your store in Settings → Shopify.");
    if (!res.ok || body.errors) {
      const msg = typeof body.errors === "string" ? body.errors : (body.errors ?? []).map((e) => e.message).join("; ");
      throw new Error(`Shopify: ${msg || `HTTP ${res.status}`}`.slice(0, 300));
    }
    return body.data ?? {};
  }
  throw new Error("Shopify is busy right now. Please try again in a minute.");
}

const PRODUCT_SET = `mutation Launch($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id handle onlineStorePreviewUrl }
    userErrors { field message }
  }
}`;

export const run = internalAction({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args): Promise<void> => {
    const fail = async (error: string): Promise<void> => {
      await ctx.runMutation(internal.launch.setStatus, { launchId: args.launchId, status: "failed", error: error.slice(0, 300) });
    };
    const c = await ctx.runQuery(internal.launch.context, { launchId: args.launchId });
    if (!c) return;
    if (!c.product || !c.store) return fail("The product or the connected store is gone.");
    const { launch, product, store, ads } = c;

    // 1. Write the page and ad kit.
    let copy: LaunchCopy;
    try {
      if (!process.env.ANTHROPIC_API_KEY) return fail("The AI isn't set up yet (missing ANTHROPIC_API_KEY).");
      const message = await claudeClient().messages.parse({
        model: MODEL,
        max_tokens: 6000,
        system: LAUNCH_SYSTEM,
        messages: [{ role: "user", content: launchFacts(product, ads, { language: launch.language, tone: launch.tone, price: launch.price }) }],
        output_config: { effort: "low", format: zodOutputFormat(CopySchema) },
      });
      if (message.stop_reason === "refusal" || !message.parsed_output) return fail("The AI couldn't write this page. Try again or pick another product.");
      copy = cleanCopy(message.parsed_output as LaunchCopy).copy;
    } catch (e) {
      console.error("Launch: AI failed", e);
      return fail(e instanceof Anthropic.APIError ? claudeErrorMessage(e, false) : "The AI had a problem. Please try again.");
    }
    await ctx.runMutation(internal.launch.setStatus, { launchId: args.launchId, status: "publishing", copy });

    // 2. Create it in the store.
    try {
      const token = await decryptToken(store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
      const input = launchProductInput(product, copy, { price: launch.price, cost: product.cost, status: launch.publish === "ACTIVE" ? "ACTIVE" : "DRAFT" });
      const data = (await shopify(store.shopDomain, token, PRODUCT_SET, { input })) as {
        productSet?: { product: { id: string; handle: string; onlineStorePreviewUrl?: string } | null; userErrors: { message: string }[] };
      };
      const created = data.productSet?.product;
      if (!created) return fail(`Shopify: ${(data.productSet?.userErrors ?? []).map((e) => e.message).join("; ") || "the product wasn't created"}`);
      const numericId = created.id.split("/").pop();
      let storeUrl = created.onlineStorePreviewUrl;
      if (launch.publish === "ACTIVE") {
        // Put it on the Online Store sales channel (needs the app's publications scope).
        try {
          const pubs = (await shopify(store.shopDomain, token, "{ publications(first: 20) { nodes { id name } } }")) as { publications?: { nodes: { id: string; name: string }[] } };
          const online = pubs.publications?.nodes.find((p) => /online store/i.test(p.name));
          if (online) {
            await shopify(store.shopDomain, token, "mutation P($id: ID!, $pub: ID!) { publishablePublish(id: $id, input: [{ publicationId: $pub }]) { userErrors { message } } }", { id: created.id, pub: online.id });
            storeUrl = `https://${store.shopDomain}/products/${created.handle}`;
          }
        } catch (e) {
          console.warn("Launch: couldn't publish to the Online Store", e);
        }
      }
      await ctx.runMutation(internal.launch.setStatus, {
        launchId: args.launchId,
        status: "published",
        shopifyProductId: created.id,
        adminUrl: `https://${store.shopDomain}/admin/products/${numericId}`,
        ...(storeUrl ? { storeUrl } : {}),
      });
    } catch (e) {
      console.error("Launch: publish failed", e);
      return fail(e instanceof Error ? e.message : "Publishing to Shopify failed.");
    }
  },
});
