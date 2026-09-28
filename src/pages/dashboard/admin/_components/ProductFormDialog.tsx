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
import { Switch } from "@/components/ui/switch.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { useEffect } from "react";
import { NICHES } from "@/convex/lib/category.ts";

const categories: string[] = NICHES.filter((n) => n !== "Other");
const saturations = ["Low", "Medium", "High"];
const trends = ["Rising", "Stable", "Declining"];

const productSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string().min(10, "Description should be at least 10 characters"),
  imageUrl: z.string().url("Must be a valid URL"),
  price: z.coerce.number().positive("Price must be positive"),
  cost: z.coerce.number().nonnegative("Cost cannot be negative"),
  category: z.string().min(1, "Category is required"),
  tags: z.string(),
  aiScore: z.coerce.number().min(0).max(100),
  saturation: z.string().min(1),
  trend: z.string().min(1),
  supplierUrl: z.string().url("Must be a valid URL"),
  isWinnerOfDay: z.boolean(),
});

type ProductFormValues = z.infer<typeof productSchema>;
type ProductFormInput = z.input<typeof productSchema>;
type Product = Doc<"products">;

export default function ProductFormDialog({
  product,
  open,
  onOpenChange,
}: {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createProduct = useMutation(api.admin.products.createProduct);
  const updateProduct = useMutation(api.admin.products.updateProduct);

  const form = useForm<ProductFormInput, unknown, ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      title: "",
      description: "",
      imageUrl: "",
      price: 0,
      cost: 0,
      category: categories[0],
      tags: "",
      aiScore: 75,
      saturation: "Medium",
      trend: "Stable",
      supplierUrl: "https://www.aliexpress.com",
      isWinnerOfDay: true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset(
        product
          ? {
              title: product.title,
              description: product.description,
              imageUrl: product.imageUrl,
              price: product.price,
              cost: product.cost,
              category: product.category,
              tags: product.tags.join(", "),
              aiScore: product.aiScore,
              saturation: product.saturation,
              trend: product.trend,
              supplierUrl: product.supplierUrl,
              isWinnerOfDay: product.isWinnerOfDay,
            }
          : {
              title: "",
              description: "",
              imageUrl: "",
              price: 0,
              cost: 0,
              category: categories[0],
              tags: "",
              aiScore: 75,
              saturation: "Medium",
              trend: "Stable",
              supplierUrl: "https://www.aliexpress.com",
              isWinnerOfDay: true,
            }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product]);

  const onSubmit = async (values: ProductFormValues) => {
    const tags = values.tags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      if (product) {
        await updateProduct({ id: product._id, ...values, tags });
        toast.success("Product updated");
      } else {
        await createProduct({ ...values, tags });
        toast.success("Product created");
      }
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save product";
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "Add winning product"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="ProGrip Posture Corrector" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Why this product is winning..." rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="imageUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Image URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://images.unsplash.com/..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sell price ($)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>AliExpress cost ($)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} value={field.value as number} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                name="saturation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Saturation</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {saturations.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="trend"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trend</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {trends.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
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
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tags (comma separated)</FormLabel>
                  <FormControl>
                    <Input placeholder="posture, back pain, WFH" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="supplierUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Supplier URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://www.aliexpress.com/..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isWinnerOfDay"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                  <FormLabel className="mb-0">Feature as Winner of the Day</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Spinner className="mr-1.5" />}
                {product ? "Save changes" : "Add product"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export type { Product, ProductFormValues };
export type ProductId = Id<"products">;
