import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { useEffect } from "react";

const platforms = ["Facebook", "Instagram", "TikTok", "Amazon"];
const sources = ["meta_ad_library", "curated"];
const genders = ["All", "Male", "Female"];

const adSchema = z.object({
  advertiserName: z.string().min(2, "Advertiser name is required"),
  platform: z.string().min(1),
  country: z.string().min(2, "Use a 2-letter ISO country code").max(2),
  niche: z.string().min(2, "Niche is required"),
  headline: z.string().min(5, "Headline is required"),
  bodyText: z.string().min(10, "Body text should be at least 10 characters"),
  creativeUrl: z.string().url("Must be a valid URL"),
  landingPageUrl: z.string().url("Must be a valid URL"),
  spendEstimate: z.string().min(2, "e.g. \"$5K–$10K/mo\""),
  likes: z.coerce.number().nonnegative(),
  views: z.string().min(1, "e.g. \"1.2M\""),
  daysRunning: z.coerce.number().nonnegative(),
  aiScore: z.coerce.number().min(0).max(100),
  ageRange: z.string().min(2, "e.g. \"25–44\""),
  gender: z.string().min(1),
  interests: z.string(),
  source: z.string().min(1),
});

type AdFormValues = z.infer<typeof adSchema>;
type AdFormInput = z.input<typeof adSchema>;
type Ad = Doc<"ads">;

export default function AdFormDialog({
  ad,
  open,
  onOpenChange,
}: {
  ad: Ad | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createAd = useMutation(api.admin.ads.createAd);
  const updateAd = useMutation(api.admin.ads.updateAd);

  const defaults: AdFormInput = {
    advertiserName: "",
    platform: platforms[0],
    country: "US",
    niche: "",
    headline: "",
    bodyText: "",
    creativeUrl: "",
    landingPageUrl: "",
    spendEstimate: "",
    likes: 0,
    views: "",
    daysRunning: 0,
    aiScore: 75,
    ageRange: "25–44",
    gender: "All",
    interests: "",
    source: "curated",
  };

  const form = useForm<AdFormInput, unknown, AdFormValues>({
    resolver: zodResolver(adSchema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (open) {
      form.reset(
        ad
          ? {
              advertiserName: ad.advertiserName,
              platform: ad.platform,
              country: ad.country,
              niche: ad.niche,
              headline: ad.headline,
              bodyText: ad.bodyText,
              creativeUrl: ad.creativeUrl,
              landingPageUrl: ad.landingPageUrl,
              spendEstimate: ad.spendEstimate,
              likes: ad.likes,
              views: ad.views,
              daysRunning: ad.daysRunning,
              aiScore: ad.aiScore,
              ageRange: ad.targeting.ageRange,
              gender: ad.targeting.gender,
              interests: ad.targeting.interests.join(", "),
              source: ad.source,
            }
          : defaults
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ad]);

  const onSubmit = async (values: AdFormValues) => {
    const interests = values.interests.split(",").map((t) => t.trim()).filter(Boolean);
    const { ageRange, gender, interests: _interests, ...rest } = values;
    const payload = { ...rest, targeting: { ageRange, gender, interests } };
    try {
      if (ad) {
        await updateAd({ id: ad._id, ...payload });
        toast.success("Ad updated");
      } else {
        await createAd(payload);
        toast.success("Ad created");
      }
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save ad";
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ad ? "Edit ad" : "Add curated ad"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="advertiserName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Advertiser name</FormLabel>
                    <FormControl>
                      <Input placeholder="PosturePro Official" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="platform"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Platform</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {platforms.map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country code</FormLabel>
                    <FormControl>
                      <Input placeholder="US" maxLength={2} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="niche"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Niche</FormLabel>
                    <FormControl>
                      <Input placeholder="Health & Wellness" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="headline"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Headline</FormLabel>
                  <FormControl>
                    <Input placeholder="Fix Your Posture in 30 Days" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bodyText"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Body text</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Ad copy..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="creativeUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Creative image URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://images.unsplash.com/..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="landingPageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Landing page URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://example.com/..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="spendEstimate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Spend estimate</FormLabel>
                    <FormControl>
                      <Input placeholder="$15K–$25K/mo" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="likes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Likes</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="views"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Views</FormLabel>
                    <FormControl>
                      <Input placeholder="2.4M" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="daysRunning"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Days running</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="aiScore"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>AI score (0-100)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={100} {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="ageRange"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target age range</FormLabel>
                    <FormControl>
                      <Input placeholder="25–44" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target gender</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {genders.map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="interests"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target interests (comma separated)</FormLabel>
                  <FormControl>
                    <Input placeholder="Chiropractic, Ergonomics, Remote work" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {sources.map((s) => (
                        <SelectItem key={s} value={s}>{s === "meta_ad_library" ? "Meta Ad Library" : "Curated (TikTok/Amazon/global)"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Spinner className="mr-1.5" />}
                {ad ? "Save changes" : "Add ad"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
