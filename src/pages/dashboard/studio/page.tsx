import { useSearchParams } from "react-router-dom";
import { Clapperboard } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import RemakeTab from "./_components/RemakeTab.tsx";
import Playground from "./_components/Playground.tsx";
import MyVideos from "./_components/MyVideos.tsx";

// AI Studio (/dashboard/studio): the ad's AI tools (Remake an ad, ?ad=<id>), the fal video Playground, and
// My videos. The tab lives in ?tab= so links and Back keep it; an ad link opens on Remake an ad.

const TABS = ["remake", "playground", "videos"] as const;
type Tab = (typeof TABS)[number];

export default function StudioPage() {
  const [params, setParams] = useSearchParams();
  const ad = params.get("ad");
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) ? asked : ad ? "remake" : "playground";

  const pick = (next: string) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <Clapperboard className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-bold">AI Studio</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">Remake winning ads, make AI clips, and keep all your AI videos in one place.</p>
      <Tabs value={tab} onValueChange={pick}>
        <TabsList>
          <TabsTrigger value="remake">Remake an ad</TabsTrigger>
          <TabsTrigger value="playground">Playground</TabsTrigger>
          <TabsTrigger value="videos">My videos</TabsTrigger>
        </TabsList>
        <TabsContent value="remake" className="mt-4">
          <RemakeTab adId={ad} />
        </TabsContent>
        <TabsContent value="playground" className="mt-4">
          <Playground />
        </TabsContent>
        <TabsContent value="videos" className="mt-4">
          <MyVideos />
        </TabsContent>
      </Tabs>
    </div>
  );
}
