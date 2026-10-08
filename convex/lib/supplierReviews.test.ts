import { describe, expect, it } from "vitest";
import { aliexpressId, aliexpressIds, combineListings, parseListing, parseReviews } from "./supplierReviews";

// Shaped like feedback.aliexpress.com's real answer (2026-10-08).
const review = (o: Record<string, unknown>) => ({
  anonymous: false, buyerName: "Y***c", buyerCountry: "FR", buyerEval: 100, buyerFeedback: "original", evalDate: "10 Aug 2026", images: [], ...o,
});
const body = {
  data: {
    productEvaluationStatistic: { evarageStar: 4.66, totalNum: 42, fiveStarNum: 38, fourStarNum: 2, threeStarNum: 1, twoStarNum: 0, oneStarNum: 1 },
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
    expect(r).toMatchObject({ source: "aliexpress", average: 4.7, total: 42, stars: [38, 2, 1, 0, 1], listings: 1 });
    expect(r.items.map((i) => i.text)).toEqual([
      "My dogs love this toy, and so do the dogs I train.", // with a photo, first
      "Large and practical, great as an activity for a dog",
    ]);
    expect(r.items[0]).toMatchObject({ name: "", country: "BR", rating: 5, images: ["https://ae-pic-a1.aliexpress-media.com/kf/A1.jpg"] });
    expect(r.items[1].name).toBe("Y***c");
  });

  it("reads up to 3 links, and combines sellers of the same product", () => {
    expect(aliexpressIds("https://www.aliexpress.com/item/1005012573349832.html\nhttps://www.aliexpress.com/item/1005012299631792.html, nope https://www.aliexpress.com/item/1005012573349832.html")).toEqual([
      "1005012573349832", "1005012299631792",
    ]);
    expect(aliexpressIds("a https://aliexpress.com/item/11111111.html b https://aliexpress.com/item/22222222.html https://aliexpress.com/item/33333333.html https://aliexpress.com/item/44444444.html")).toHaveLength(3);
    // The brush listing (2026-10-08): 15 reviews, one written 4–5 star one.
    const brush = parseListing({ data: { productEvaluationStatistic: { evarageStar: 4.7, totalNum: 15, fiveStarNum: 13, threeStarNum: 2 }, evaViewList: [
      review({ buyerTranslationFeedback: "Good cat brushes spray a little water on them before brushing" }),
      review({ buyerTranslationFeedback: "" }),
      review({ buyerEval: 60, buyerTranslationFeedback: "Its very poor quality" }),
    ] } });
    expect(brush?.items).toHaveLength(1);
    const both = combineListings([brush, parseListing(body), null])!;
    expect(both).toMatchObject({ total: 57, listings: 2, stars: [51, 2, 3, 0, 1] });
    expect(both.average).toBe(4.7); // (4.7 × 15 + 4.66 × 42) / 57
    expect(both.items).toHaveLength(3);
    // Stars but no written review worth showing: nothing.
    expect(combineListings([parseListing({ data: { productEvaluationStatistic: { evarageStar: 5, totalNum: 3 }, evaViewList: [review({ buyerTranslationFeedback: "" })] } })])).toBeNull();
  });

  it("returns nothing for a listing without reviews", () => {
    expect(parseReviews({ data: { productEvaluationStatistic: { evarageStar: 0, totalNum: 0 }, evaViewList: [] } })).toBeNull();
    expect(parseReviews(null)).toBeNull();
  });
});
