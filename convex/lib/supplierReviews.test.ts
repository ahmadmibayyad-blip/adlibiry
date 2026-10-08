import { describe, expect, it } from "vitest";
import { aliexpressId, parseReviews } from "./supplierReviews";

// Shaped like feedback.aliexpress.com's real answer (2026-10-08).
const review = (o: Record<string, unknown>) => ({
  anonymous: false, buyerName: "Y***c", buyerCountry: "FR", buyerEval: 100, buyerFeedback: "original", evalDate: "10 Aug 2026", images: [], ...o,
});
const body = {
  data: {
    productEvaluationStatistic: { evarageStar: 4.66, totalNum: 42 },
    evaViewList: [
      review({ buyerTranslationFeedback: "Large and practical, great as an activity for a dog" }),
      review({ anonymous: true, buyerName: "AliExpress Shopper", buyerCountry: "BR", buyerTranslationFeedback: "My dogs love this toy, and so do the dogs I train.", images: ["https://ae-pic-a1.aliexpress-media.com/kf/A1.jpg", "http://insecure/x.jpg"] }),
      review({ buyerTranslationFeedback: "Arrived quickly, well packed, thanks seller" }),
      review({ buyerEval: 60, buyerTranslationFeedback: "It is okay but smaller than I thought it would be" }),
      review({ buyerTranslationFeedback: "Good" }),
      review({ buyerTranslationFeedback: "Large and practical, great as an activity for a dog" }),
    ],
  },
};

describe("Supplier reviews", () => {
  it("finds the product id in AliExpress links", () => {
    expect(aliexpressId("https://www.aliexpress.com/item/1005012299631792.html?spm=a2g0o")).toBe("1005012299631792");
    expect(aliexpressId("https://da.aliexpress.com/item/1005010435563073.html")).toBe("1005010435563073");
    expect(aliexpressId("https://s.click.aliexpress.com/e/_abc")).toBeNull();
    expect(aliexpressId("https://www.amazon.com/item/1005012299631792.html")).toBeNull();
    expect(aliexpressId("not a link")).toBeNull();
  });

  it("keeps real, on-topic 4–5 star reviews with the listing's real average", () => {
    const r = parseReviews(body)!;
    expect(r).toMatchObject({ source: "aliexpress", average: 4.7, total: 42 });
    expect(r.items.map((i) => i.text)).toEqual([
      "My dogs love this toy, and so do the dogs I train.", // with a photo, first
      "Large and practical, great as an activity for a dog",
    ]);
    expect(r.items[0]).toMatchObject({ name: "", country: "BR", rating: 5, images: ["https://ae-pic-a1.aliexpress-media.com/kf/A1.jpg"] });
    expect(r.items[1].name).toBe("Y***c");
  });

  it("returns nothing for a listing without reviews", () => {
    expect(parseReviews({ data: { productEvaluationStatistic: { evarageStar: 0, totalNum: 0 }, evaViewList: [] } })).toBeNull();
    expect(parseReviews(null)).toBeNull();
  });
});
