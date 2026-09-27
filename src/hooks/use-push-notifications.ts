import { api } from "@/convex/_generated/api.js";
import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const SECRET_KEY = "adspy-push-subscription-secret";

type NotificationStatus =
  "unsupported" | "iframe" | "denied" | "loading" | "subscribed" | "unsubscribed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function usePushNotifications(isAuthenticated?: boolean) {
  const [secret, setSecret] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(SECRET_KEY) : null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : null
  );
  const getVapidPublicKey = useAction(api.pushNotifications.getVapidPublicKey);
  const registerSubscription = useAction(api.pushNotifications.subscribe);
  const identifySubscription = useAction(api.pushNotifications.identify);
  const removeSubscription = useAction(api.pushNotifications.unsubscribe);

  // Track if we've already identified this session
  const hasIdentified = useRef(false);

  // Compute status from state
  const status: NotificationStatus = useMemo(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      return "unsupported";
    }
    if (isInIframe()) {
      return "iframe";
    }
    if (permission === "denied") {
      return "denied";
    }
    if (isLoading) {
      return "loading";
    }
    if (secret !== null) {
      return "subscribed";
    }
    return "unsubscribed";
  }, [permission, isLoading, secret]);

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (status === "unsupported" || status === "iframe" || status === "denied") {
      return { error: `Cannot subscribe: ${status}` };
    }

    setIsLoading(true);
    try {
      // Get VAPID public key from backend
      const { vapidPublicKey } = await getVapidPublicKey();
      if (!vapidPublicKey) {
        return { error: "Failed to get VAPID public key" };
      }

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        return { permission: "denied" };
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });

      // Register subscription with Hercules via Convex
      // Server handles identity - generates visitorId automatically
      const { secret: newSecret } = await registerSubscription({
        subscription: JSON.stringify(subscription),
      });

      // Store secret for later operations
      localStorage.setItem(SECRET_KEY, newSecret);
      setSecret(newSecret);

      return { permission: "granted", subscribed: true };
    } catch (error) {
      toast.error("Failed to enable push notifications. Please try again.");
      return { error: String(error) };
    } finally {
      setIsLoading(false);
    }
  }, [status, getVapidPublicKey, registerSubscription]);

  // Link anonymous subscription to authenticated user (call after sign-in)
  const identify = useCallback(async () => {
    const currentSecret = secret ?? localStorage.getItem(SECRET_KEY);
    if (!currentSecret) {
      return { noSubscription: true };
    }

    try {
      const result = await identifySubscription({ secret: currentSecret });
      return result;
    } catch (error) {
      return { error: String(error) };
    }
  }, [secret, identifySubscription]);

  // Auto-identify when user becomes authenticated
  useEffect(() => {
    if (isAuthenticated && !hasIdentified.current && secret) {
      hasIdentified.current = true;
      identify();
    }
    // Reset when user logs out so we can identify again on next login
    if (!isAuthenticated) {
      hasIdentified.current = false;
    }
  }, [isAuthenticated, secret, identify]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    const currentSecret = secret ?? localStorage.getItem(SECRET_KEY);
    if (!currentSecret) {
      return { error: "No subscription to remove" };
    }

    setIsLoading(true);
    try {
      // Unsubscribe from browser's PushManager
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }

      // Remove from Hercules
      await removeSubscription({ secret: currentSecret });

      // Clear stored secret
      localStorage.removeItem(SECRET_KEY);
      setSecret(null);

      return { success: true };
    } catch (error) {
      return { error: String(error) };
    } finally {
      setIsLoading(false);
    }
  }, [secret, removeSubscription]);

  return {
    status,
    subscribe,
    identify, // Call after sign-in to link anonymous subscription
    unsubscribe,
  };
}
