import { Settings as SettingsIcon, Bell } from "lucide-react";
import { motion } from "motion/react";
import { Authenticated, Unauthenticated } from "convex/react";
import { Link } from "react-router-dom";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import ProfileSection from "./_components/ProfileSection.tsx";
import PlanSection from "./_components/PlanSection.tsx";
import AppearanceSection from "./_components/AppearanceSection.tsx";
import AccountSection from "./_components/AccountSection.tsx";

export default function SettingsPage() {
  return (
    <div className="p-5 lg:p-8 max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <SettingsIcon className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage your profile, subscription, and app preferences.
        </p>
      </motion.div>

      <Unauthenticated>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><SettingsIcon /></EmptyMedia>
            <EmptyTitle>Sign in to view settings</EmptyTitle>
            <EmptyDescription>Manage your profile, plan, and preferences once signed in.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Unauthenticated>

      <Authenticated>
        <div className="space-y-5">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
            <ProfileSection />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
            <PlanSection />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
            <AppearanceSection />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}>
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="font-semibold text-sm mb-1">Notifications</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Manage what triggers an alert and enable push notifications on this device.
              </p>
              <Link
                to="/dashboard/alerts"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Bell className="w-3.5 h-3.5" />
                Go to alert preferences
              </Link>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.25 }}>
            <AccountSection />
          </motion.div>
        </div>
      </Authenticated>
    </div>
  );
}
