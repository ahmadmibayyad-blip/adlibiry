import { useAuth } from "@/hooks/use-auth.ts";
import { Avatar, AvatarFallback } from "@/components/ui/avatar.tsx";

export default function ProfileSection() {
  const { user } = useAuth();

  const initials = user?.profile?.name
    ? user.profile.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : "U";

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="font-semibold text-sm mb-4">Profile</h2>
      <div className="flex items-center gap-4">
        <Avatar className="w-14 h-14">
          <AvatarFallback className="bg-primary/20 text-primary text-lg font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="font-medium truncate">{user?.profile?.name ?? "AdSpy Pro User"}</div>
          <div className="text-sm text-muted-foreground truncate">
            {user?.profile?.email ?? "No email on file"}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-4">
        Your name and email are managed by your sign-in provider and can't be edited here.
      </p>
    </div>
  );
}
