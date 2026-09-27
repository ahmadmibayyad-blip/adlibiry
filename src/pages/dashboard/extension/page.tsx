import { Puzzle, Download, ShieldCheck, Sparkles, Globe } from "lucide-react";
import { motion } from "motion/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Authenticated, Unauthenticated } from "convex/react";
import ModerationQueue from "./_components/ModerationQueue.tsx";

const steps = [
  {
    title: "Download the extension",
    description: "Click the download button below to get the AdSpy Pro Ad Collector .zip file.",
  },
  {
    title: "Unzip the file",
    description: "Extract the .zip anywhere on your computer — you'll get a folder named \"chrome-extension\".",
  },
  {
    title: "Open Chrome extensions",
    description: "Go to chrome://extensions in your browser address bar.",
  },
  {
    title: "Enable Developer mode",
    description: "Toggle \"Developer mode\" on in the top-right corner of the extensions page.",
  },
  {
    title: "Load the extension",
    description: "Click \"Load unpacked\" and select the unzipped \"chrome-extension\" folder.",
  },
  {
    title: "Browse as usual",
    description: "Scroll Facebook or TikTok normally — sponsored ads you see are anonymously added to AdSpy Pro's database.",
  },
];

export default function ExtensionPage() {
  const isAdmin = useQuery(api.users.isAdmin);

  return (
    <div className="p-5 lg:p-8 max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <Puzzle className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Chrome Extension</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Help build the world's largest crowdsourced ad database. Install the AdSpy Pro Ad Collector and every sponsored ad you scroll past on Facebook or TikTok gets anonymously added to Ad Spy.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="bg-card border border-border rounded-xl p-6 mb-6"
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Globe className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">AdSpy Pro Ad Collector</div>
              <div className="text-xs text-muted-foreground">v1.0.0 · works on Facebook &amp; TikTok</div>
            </div>
          </div>
          <a href="/adspy-pro-extension.zip" download>
            <Button>
              <Download className="w-4 h-4 mr-2" />
              Download extension
            </Button>
          </a>
        </div>

        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
          <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
          <p className="text-xs text-muted-foreground">
            100% anonymous — the extension never reads your account, messages, or personal posts. It only collects publicly visible sponsored ad content.
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="mb-8"
      >
        <h2 className="font-semibold text-sm mb-3">Installation guide</h2>
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={step.title} className="flex items-start gap-3 bg-card border border-border rounded-xl p-4">
              <div className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </div>
              <div>
                <div className="text-sm font-medium">{step.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{step.description}</div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      <Authenticated>
        {isAdmin && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Submission review queue</h2>
              <Badge variant="secondary">Admin only</Badge>
            </div>
            <ModerationQueue />
          </motion.div>
        )}
      </Authenticated>

      <Unauthenticated>
        <p className="text-xs text-muted-foreground text-center mt-4">
          Sign in to see admin moderation tools if you manage this platform's ad database.
        </p>
      </Unauthenticated>
    </div>
  );
}
