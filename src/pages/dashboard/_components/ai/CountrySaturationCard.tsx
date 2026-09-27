import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { AnimatePresence, motion } from "motion/react";
import {
  Globe2, Sparkles, TrendingUp, TrendingDown, Minus, ShieldCheck, Megaphone,
  Store as StoreIcon, LineChart as LineChartIcon, PackageSearch, CheckCircle2, XCircle,
  Trophy, BarChart3, Info,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart.tsx";
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, BarChart, Bar,
} from "recharts";
import { cn } from "@/lib/utils.ts";
import { SATURATION_COUNTRIES, countryName } from "@/lib/countries.ts";
import AIFeatureGate from "./AIFeatureGate.tsx";

type SaturationSignals = {
  localAdvertiserCount: number;
  localActiveAds: number;
  recentLocalAdvertisers30d: number;
  globalAdvertiserCount: number;
  localStoreCount: number;
  localStoreActiveAds: number;
  supplierSellerCount?: number;
  trendInterest?: number;
  trendDirection?: string;
  trendRisingPercent?: number;
  sourcesAnalyzed: string[];
  sourcesUnavailable: string[];
};

type SaturationResult = {
  saturationScore: number;
  saturationLabel: string;
  demandScore: number;
  demandLabel: string;
  opportunityScore: number;
  opportunityLabel: string;
  confidenceScore: number;
  signals: SaturationSignals;
  aiSummary: string;
};

type ComparisonRow = {
  country: string;
  saturationScore: number;
  saturationLabel: string;
  demandScore: number;
  demandLabel: string;
  opportunityScore: number;
  opportunityLabel: string;
  confidenceScore: number;
  localAdvertiserCount: number;
  localStoreCount: number;
};

const trendChartConfig = {
  saturationScore: { label: "Saturation", color: "var(--chart-5)" },
  demandScore: { label: "Demand", color: "var(--chart-2)" },
  opportunityScore: { label: "Opportunity", color: "var(--chart-1)" },
} satisfies ChartConfig;

const compareChartConfig = {
  saturationScore: { label: "Saturation", color: "var(--chart-5)" },
  demandScore: { label: "Demand", color: "var(--chart-2)" },
  opportunityScore: { label: "Opportunity", color: "var(--chart-1)" },
} satisfies ChartConfig;

const DEFAULT_COMPARE_COUNTRIES = ["US", "GB", "DE", "AU"];

const SCORE_EXPLANATIONS: Record<string, string> = {
  Saturation: "How many competitors are already advertising or selling this product in this country. Higher means more crowded.",
  Demand: "How much real buyer interest this country shows — search trends, ad reach, and store activity combined. Higher means more shoppers are looking for it.",
  Opportunity: "Derived from Demand minus Saturation — high demand with few competitors scores highest. A country with zero data on both scores low here, not high, since there's no evidence of an actual opportunity.",
};

function scoreRingColor(score: number, invert: boolean) {
  const effective = invert ? 100 - score : score;
  if (effective >= 70) return "text-green-400 border-green-400/30";
  if (effective >= 40) return "text-yellow-400 border-yellow-400/30";
  return "text-red-400 border-red-400/30";
}

function ScoreDial({ label, score, invert, sub }: { label: string; score: number; invert: boolean; sub: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 flex-1 min-w-[92px]">
      <div className={cn("w-14 h-14 sm:w-16 sm:h-16 rounded-full border-4 flex items-center justify-center", scoreRingColor(score, invert))}>
        <span className="text-base sm:text-lg font-black">{score}</span>
      </div>
      <div>
        <div className="flex items-center justify-center gap-1 text-xs font-semibold">
          {label}
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3 h-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-56 text-center">{SCORE_EXPLANATIONS[label]}</TooltipContent>
          </Tooltip>
        </div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

function TrendIcon({ direction }: { direction?: string }) {
  if (direction === "Rising") return <TrendingUp className="w-3.5 h-3.5 text-green-400" />;
  if (direction === "Declining") return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

function CheckResultSkeleton() {
  return (
    <div className="pt-3 border-t border-border space-y-4">
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2 flex-1 min-w-[92px]">
            <Skeleton className="w-14 h-14 sm:w-16 sm:h-16 rounded-full" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function CompareResultSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-52 w-full rounded-lg" />
      <div className="space-y-1.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default function CountrySaturationCard({
  productTitle,
  niche,
}: {
  productTitle: string;
  niche: string;
}) {
  const analyzeSaturation = useAction(api.saturation.analyze.analyzeSaturation);
  const compareCountries = useAction(api.saturation.compare.compareCountries);

  const [country, setCountry] = useState<string>("US");
  const [result, setResult] = useState<SaturationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [selectedCompareCountries, setSelectedCompareCountries] = useState<string[]>(DEFAULT_COMPARE_COUNTRIES);
  const [comparison, setComparison] = useState<ComparisonRow[] | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  const history = useQuery(
    api.saturation.mutations.getHistory,
    result ? { niche, country } : "skip"
  );

  const handleCheck = async () => {
    setIsLoading(true);
    try {
      const res = await analyzeSaturation({ productTitle, niche, country });
      setResult(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run saturation check";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCompareCountry = (code: string) => {
    setSelectedCompareCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleCompare = async () => {
    if (selectedCompareCountries.length < 2) {
      toast.error("Pick at least 2 countries to compare");
      return;
    }
    setIsComparing(true);
    try {
      const res = await compareCountries({ niche, countries: selectedCompareCountries });
      setComparison(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to compare countries";
      toast.error(message);
    } finally {
      setIsComparing(false);
    }
  };

  const bestOpportunity = comparison
    ? comparison.reduce((best, row) => (row.opportunityScore > best.opportunityScore ? row : best), comparison[0])
    : null;

  const trendChartData = history?.map((h) => ({
    date: new Date(h.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    saturationScore: h.saturationScore,
    demandScore: h.demandScore,
    opportunityScore: h.opportunityScore,
  }));

  return (
    <AIFeatureGate>
      <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <Globe2 className="w-4 h-4 text-primary shrink-0" />
          <h3 className="font-semibold text-sm">Country Saturation Analyzer</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Checks how crowded this product is by country, using our real tracked Ad Spy, Store Tracker, Trends, and Supplier data — never invented numbers.
        </p>

        <Tabs defaultValue="check">
          <TabsList className="mb-3 w-full sm:w-auto">
            <TabsTrigger value="check" className="flex-1 sm:flex-none">Check a country</TabsTrigger>
            <TabsTrigger value="compare" className="flex-1 sm:flex-none">Compare countries</TabsTrigger>
          </TabsList>

          {/* ── Single-country check ─────────────────────────────────────── */}
          <TabsContent value="check">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-3">
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="flex-1 w-full">
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent>
                  {SATURATION_COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleCheck} disabled={isLoading} className="shrink-0 w-full sm:w-auto">
                {isLoading ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                {isLoading ? "Analyzing..." : "Check Saturation"}
              </Button>
            </div>

            {isLoading && !result && <CheckResultSkeleton />}

            <AnimatePresence mode="wait">
              {result && !isLoading && (
                <motion.div
                  key={`${country}-${result.saturationScore}-${result.demandScore}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="pt-3 border-t border-border space-y-4"
                >
                  {/* Three separate scores — saturation and demand are never conflated */}
                  <div className="flex gap-2">
                    <ScoreDial label="Saturation" score={result.saturationScore} invert sub={result.saturationLabel} />
                    <ScoreDial label="Demand" score={result.demandScore} invert={false} sub={result.demandLabel} />
                    <ScoreDial label="Opportunity" score={result.opportunityScore} invert={false} sub={result.opportunityLabel} />
                  </div>

                  {/* Confidence */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="flex items-center gap-1.5 font-medium">
                        <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                        Data confidence
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-56 text-center">
                            How complete our tracked data is for this country. Missing sources lower confidence but never fake a score.
                          </TooltipContent>
                        </Tooltip>
                      </span>
                      <span className="text-muted-foreground">{result.confidenceScore}/100</span>
                    </div>
                    <Progress value={result.confidenceScore} className="h-1.5" />
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                      {result.signals.sourcesAnalyzed.map((s) => (
                        <span key={s} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CheckCircle2 className="w-3 h-3 text-green-400" />
                          {s}
                        </span>
                      ))}
                      {result.signals.sourcesUnavailable.map((s) => (
                        <span key={s} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <XCircle className="w-3 h-3 text-red-400" />
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* AI summary — grounded only in the numbers below */}
                  <p className="text-sm leading-relaxed bg-muted rounded-lg p-3">{result.aiSummary}</p>

                  {/* Competitor breakdown */}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Competitor breakdown — {country}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="bg-muted rounded-lg p-2.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                          <Megaphone className="w-3 h-3" /> Local advertisers
                        </div>
                        <div className="text-sm font-bold">{result.signals.localAdvertiserCount}</div>
                      </div>
                      <div className="bg-muted rounded-lg p-2.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                          <Megaphone className="w-3 h-3" /> Active local ads
                        </div>
                        <div className="text-sm font-bold">{result.signals.localActiveAds}</div>
                      </div>
                      <div className="bg-muted rounded-lg p-2.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                          <TrendingUp className="w-3 h-3" /> Advertisers, last 30d
                        </div>
                        <div className="text-sm font-bold">{result.signals.recentLocalAdvertisers30d}</div>
                      </div>
                      <div className="bg-muted rounded-lg p-2.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                          <StoreIcon className="w-3 h-3" /> Local Shopify stores
                        </div>
                        <div className="text-sm font-bold">{result.signals.localStoreCount}</div>
                      </div>
                      <div className="bg-muted rounded-lg p-2.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                          <StoreIcon className="w-3 h-3" /> Store active ads
                        </div>
                        <div className="text-sm font-bold">{result.signals.localStoreActiveAds}</div>
                      </div>
                      {result.signals.supplierSellerCount !== undefined && (
                        <div className="bg-muted rounded-lg p-2.5">
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                            <PackageSearch className="w-3 h-3" /> Avg. supplier sellers
                          </div>
                          <div className="text-sm font-bold">{result.signals.supplierSellerCount}</div>
                        </div>
                      )}
                    </div>
                    {result.signals.globalAdvertiserCount > result.signals.localAdvertiserCount && (
                      <p className="text-[11px] text-muted-foreground mt-2">
                        {result.signals.globalAdvertiserCount} advertisers tracked globally in this niche, but only{" "}
                        {result.signals.localAdvertiserCount} target {country} specifically — global presence carries less weight.
                      </p>
                    )}
                  </div>

                  {/* Trend context */}
                  {result.signals.trendDirection && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <LineChartIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                      <TrendIcon direction={result.signals.trendDirection} />
                      <span>
                        Search interest is {result.signals.trendDirection.toLowerCase()}
                        {result.signals.trendRisingPercent !== undefined && result.signals.trendRisingPercent !== 0
                          ? ` (${result.signals.trendRisingPercent > 0 ? "+" : ""}${result.signals.trendRisingPercent}% over 12 weeks)`
                          : ""}
                        {result.signals.trendInterest !== undefined ? ` — ${result.signals.trendInterest}/100 interest in ${country}` : ""}
                      </span>
                    </div>
                  )}

                  {/* Saturation trend history — only real past checks, no fabricated backfill */}
                  {trendChartData && trendChartData.length > 1 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Score history for this niche in {country}
                      </div>
                      <ChartContainer config={trendChartConfig} className="aspect-auto h-40 w-full">
                        <LineChart data={trendChartData} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" />
                          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tickMargin={8} width={28} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line
                            dataKey="saturationScore"
                            type="monotone"
                            stroke="var(--color-saturationScore)"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            dataKey="demandScore"
                            type="monotone"
                            stroke="var(--color-demandScore)"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            dataKey="opportunityScore"
                            type="monotone"
                            stroke="var(--color-opportunityScore)"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ChartContainer>
                      <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-1">
                        {Object.entries(trendChartConfig).map(([key, cfg]) => (
                          <span key={key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                            {cfg.label}
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Based on {trendChartData.length} real checks run for this niche + country over time.
                      </p>
                    </div>
                  )}

                  <Button size="sm" variant="secondary" onClick={handleCheck} disabled={isLoading} className="w-full">
                    {isLoading ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                    Re-check {country}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </TabsContent>

          {/* ── Country comparison ───────────────────────────────────────── */}
          <TabsContent value="compare">
            <p className="text-xs text-muted-foreground mb-2">
              Pick countries to score side by side for this niche, using the same real data and scoring math as a single check.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-3">
              {SATURATION_COUNTRIES.map((c) => (
                <label
                  key={c.code}
                  className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg border border-border bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                >
                  <Checkbox
                    checked={selectedCompareCountries.includes(c.code)}
                    onCheckedChange={() => toggleCompareCountry(c.code)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
            <Button onClick={handleCompare} disabled={isComparing} className="w-full mb-4">
              {isComparing ? <Spinner className="mr-1.5" /> : <BarChart3 className="w-3.5 h-3.5 mr-1.5" />}
              {isComparing ? "Comparing..." : `Compare ${selectedCompareCountries.length} countries`}
            </Button>

            {isComparing && !comparison && <CompareResultSkeleton />}

            <AnimatePresence mode="wait">
              {comparison && bestOpportunity && !isComparing && (
                <motion.div
                  key={comparison.map((r) => r.country).join(",")}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="space-y-4"
                >
                  <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg p-3">
                    <Trophy className="w-4 h-4 text-primary shrink-0" />
                    <p className="text-xs">
                      <span className="font-semibold">{countryName(bestOpportunity.country)}</span> has the best opportunity score
                      ({bestOpportunity.opportunityScore}/100) — {bestOpportunity.demandLabel.toLowerCase()} with{" "}
                      {bestOpportunity.saturationLabel.toLowerCase()}.
                    </p>
                  </div>

                  <ChartContainer config={compareChartConfig} className="aspect-auto h-52 w-full">
                    <BarChart data={comparison} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="country" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tickMargin={8} width={28} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="saturationScore" fill="var(--color-saturationScore)" radius={3} />
                      <Bar dataKey="demandScore" fill="var(--color-demandScore)" radius={3} />
                      <Bar dataKey="opportunityScore" fill="var(--color-opportunityScore)" radius={3} />
                    </BarChart>
                  </ChartContainer>
                  <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                    {Object.entries(compareChartConfig).map(([key, cfg]) => (
                      <span key={key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                        {cfg.label}
                      </span>
                    ))}
                  </div>

                  <div className="space-y-1.5">
                    {[...comparison]
                      .sort((a, b) => b.opportunityScore - a.opportunityScore)
                      .map((row) => (
                        <div
                          key={row.country}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs bg-muted rounded-lg px-3 py-2"
                        >
                          <span className="font-medium">{countryName(row.country)}</span>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                            <span>{row.localAdvertiserCount} advertisers</span>
                            <span>{row.localStoreCount} stores</span>
                            <span className="font-semibold text-foreground">Opp {row.opportunityScore}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </TabsContent>
        </Tabs>
      </div>
    </AIFeatureGate>
  );
}
