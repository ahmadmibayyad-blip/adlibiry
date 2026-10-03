/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adlibrary_client from "../adlibrary/client.js";
import type * as adlibrary_productSync from "../adlibrary/productSync.js";
import type * as adlibrary_sync from "../adlibrary/sync.js";
import type * as admin_ads from "../admin/ads.js";
import type * as admin_externalImport from "../admin/externalImport.js";
import type * as admin_helpers from "../admin/helpers.js";
import type * as admin_importCleanup from "../admin/importCleanup.js";
import type * as admin_productImport from "../admin/productImport.js";
import type * as admin_reclassify from "../admin/reclassify.js";
import type * as admin_products from "../admin/products.js";
import type * as admin_stores from "../admin/stores.js";
import type * as ads from "../ads.js";
import type * as agentRunner from "../agentRunner.js";
import type * as agents from "../agents.js";
import type * as ai from "../ai.js";
import type * as apify from "../apify.js";
import type * as assistant from "../assistant.js";
import type * as assistantUsage from "../assistantUsage.js";
import type * as auth from "../auth.js";
import type * as authOptions from "../authOptions.js";
import type * as commerce from "../commerce.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as emailDigest from "../emailDigest.js";
import type * as emailSender from "../emailSender.js";
import type * as follows from "../follows.js";
import type * as history from "../history.js";
import type * as hooks from "../hooks.js";
import type * as hooksBuilder from "../hooksBuilder.js";
import type * as http from "../http.js";
import type * as imageSearch from "../imageSearch.js";
import type * as lib_adFields from "../lib/adFields.js";
import type * as lib_aiQuota from "../lib/aiQuota.js";
import type * as lib_aiTools from "../lib/aiTools.js";
import type * as lib_authIdentity from "../lib/authIdentity.js";
import type * as lib_authUser from "../lib/authUser.js";
import type * as lib_category from "../lib/category.js";
import type * as lib_claudeErrors from "../lib/claudeErrors.js";
import type * as lib_herculesShim from "../lib/herculesShim.js";
import type * as lib_hooks from "../lib/hooks.js";
import type * as lib_pagination from "../lib/pagination.js";
import type * as lib_priceParse from "../lib/priceParse.js";
import type * as lib_productImages from "../lib/productImages.js";
import type * as lib_productMatch from "../lib/productMatch.js";
import type * as lib_rangeParsing from "../lib/rangeParsing.js";
import type * as lib_research from "../lib/research.js";
import type * as lib_saturationScoring from "../lib/saturationScoring.js";
import type * as lib_shopifyExport from "../lib/shopifyExport.js";
import type * as lib_storeSales from "../lib/storeSales.js";
import type * as lib_whTransform from "../lib/whTransform.js";
import type * as mcp from "../mcp.js";
import type * as mcpKeys from "../mcpKeys.js";
import type * as nexscope_client from "../nexscope/client.js";
import type * as nexscope_pricing from "../nexscope/pricing.js";
import type * as nexscope_productDiscovery from "../nexscope/productDiscovery.js";
import type * as nexscope_tiktokAds from "../nexscope/tiktokAds.js";
import type * as nicheReport from "../nicheReport.js";
import type * as notifications from "../notifications.js";
import type * as priceFetch from "../priceFetch.js";
import type * as productImages from "../productImages.js";
import type * as productPipeline from "../productPipeline.js";
import type * as products from "../products.js";
import type * as pushIdentities from "../pushIdentities.js";
import type * as pushNotifications from "../pushNotifications.js";
import type * as research from "../research.js";
import type * as saturation_analyze from "../saturation/analyze.js";
import type * as saturation_compare from "../saturation/compare.js";
import type * as saturation_mutations from "../saturation/mutations.js";
import type * as shopifyImport from "../shopifyImport.js";
import type * as sources_links from "../sources/links.js";
import type * as stats from "../stats.js";
import type * as storeSales from "../storeSales.js";
import type * as stores from "../stores.js";
import type * as submittedAds from "../submittedAds.js";
import type * as trends from "../trends.js";
import type * as users from "../users.js";
import type * as videoDownload from "../videoDownload.js";
import type * as winners from "../winners.js";
import type * as winninghunter from "../winninghunter.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "adlibrary/client": typeof adlibrary_client;
  "adlibrary/productSync": typeof adlibrary_productSync;
  "adlibrary/sync": typeof adlibrary_sync;
  "admin/ads": typeof admin_ads;
  "admin/externalImport": typeof admin_externalImport;
  "admin/helpers": typeof admin_helpers;
  "admin/importCleanup": typeof admin_importCleanup;
  "admin/productImport": typeof admin_productImport;
  "admin/reclassify": typeof admin_reclassify;
  "admin/products": typeof admin_products;
  "admin/stores": typeof admin_stores;
  ads: typeof ads;
  agentRunner: typeof agentRunner;
  agents: typeof agents;
  ai: typeof ai;
  apify: typeof apify;
  assistant: typeof assistant;
  assistantUsage: typeof assistantUsage;
  auth: typeof auth;
  authOptions: typeof authOptions;
  commerce: typeof commerce;
  crons: typeof crons;
  dashboard: typeof dashboard;
  emailDigest: typeof emailDigest;
  emailSender: typeof emailSender;
  follows: typeof follows;
  history: typeof history;
  hooks: typeof hooks;
  hooksBuilder: typeof hooksBuilder;
  http: typeof http;
  imageSearch: typeof imageSearch;
  "lib/adFields": typeof lib_adFields;
  "lib/aiQuota": typeof lib_aiQuota;
  "lib/aiTools": typeof lib_aiTools;
  "lib/authIdentity": typeof lib_authIdentity;
  "lib/authUser": typeof lib_authUser;
  "lib/category": typeof lib_category;
  "lib/claudeErrors": typeof lib_claudeErrors;
  "lib/herculesShim": typeof lib_herculesShim;
  "lib/hooks": typeof lib_hooks;
  "lib/pagination": typeof lib_pagination;
  "lib/priceParse": typeof lib_priceParse;
  "lib/productImages": typeof lib_productImages;
  "lib/productMatch": typeof lib_productMatch;
  "lib/rangeParsing": typeof lib_rangeParsing;
  "lib/research": typeof lib_research;
  "lib/saturationScoring": typeof lib_saturationScoring;
  "lib/shopifyExport": typeof lib_shopifyExport;
  "lib/storeSales": typeof lib_storeSales;
  "lib/whTransform": typeof lib_whTransform;
  mcp: typeof mcp;
  mcpKeys: typeof mcpKeys;
  "nexscope/client": typeof nexscope_client;
  "nexscope/pricing": typeof nexscope_pricing;
  "nexscope/productDiscovery": typeof nexscope_productDiscovery;
  "nexscope/tiktokAds": typeof nexscope_tiktokAds;
  nicheReport: typeof nicheReport;
  notifications: typeof notifications;
  priceFetch: typeof priceFetch;
  productImages: typeof productImages;
  productPipeline: typeof productPipeline;
  products: typeof products;
  pushIdentities: typeof pushIdentities;
  pushNotifications: typeof pushNotifications;
  research: typeof research;
  "saturation/analyze": typeof saturation_analyze;
  "saturation/compare": typeof saturation_compare;
  "saturation/mutations": typeof saturation_mutations;
  shopifyImport: typeof shopifyImport;
  "sources/links": typeof sources_links;
  stats: typeof stats;
  storeSales: typeof storeSales;
  stores: typeof stores;
  submittedAds: typeof submittedAds;
  trends: typeof trends;
  users: typeof users;
  videoDownload: typeof videoDownload;
  winners: typeof winners;
  winninghunter: typeof winninghunter;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
