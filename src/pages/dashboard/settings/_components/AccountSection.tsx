import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useAuth } from "@/hooks/use-auth.ts";
import { usePushNotifications } from "@/hooks/use-push-notifications.ts";

export default function AccountSection() {
  const { signout } = useAuth();
  const { unsubscribe } = usePushNotifications();

  const handleSignOut = async () => {
    await unsubscribe();
    await signout();
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="font-semibold text-sm mb-1">Account</h2>
      <p className="text-xs text-muted-foreground mb-4">Sign out of AdSpy Pro on this device.</p>
      <Button variant="secondary" onClick={handleSignOut}>
        <LogOut className="w-3.5 h-3.5 mr-1.5" />
        Sign out
      </Button>
    </div>
  );
}
