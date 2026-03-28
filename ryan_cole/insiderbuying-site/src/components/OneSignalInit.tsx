"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export function OneSignalInit() {
  const initialized = useRef(false);

  // Effect 1 — SDK init
  useEffect(() => {
    if (initialized.current) return;
    if (typeof window === "undefined") return;
    if (!process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID) return;

    initialized.current = true;

    import("react-onesignal").then((OneSignal) => {
      OneSignal.default.init({
        appId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID!,
        allowLocalhostAsSecureOrigin:
          process.env.NODE_ENV === "development",
      });
    });
  }, []);

  // Effect 2 — Link Supabase user to OneSignal subscriber
  // Note: OneSignal SDK uses an internal deferred queue, so login() works
  // even if called before init() completes — calls are queued automatically.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const supabase = createClient();
    let lastUserId: string | null = null;

    function loginOneSignal(userId: string) {
      if (userId === lastUserId) return; // skip redundant calls (e.g., TOKEN_REFRESHED)
      lastUserId = userId;
      import("react-onesignal").then((OneSignal) => {
        OneSignal.default.login(userId);
      });
    }

    function logoutOneSignal() {
      if (!lastUserId) return;
      lastUserId = null;
      import("react-onesignal").then((OneSignal) => {
        OneSignal.default.logout();
      });
    }

    // Link on mount for already-authenticated users
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) {
        loginOneSignal(session.user.id);
      }
    }).catch(() => {
      // Auth unavailable — no-op
    });

    // Re-link on auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user?.id) {
          loginOneSignal(session.user.id);
        } else if (event === "SIGNED_OUT") {
          logoutOneSignal();
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return null;
}

/**
 * Sync OneSignal tags after saving alert preferences.
 * Call this after a successful PUT to /api/alerts/subscribe.
 *
 * alert_score_min MUST be a number — W5 uses numeric <= comparison.
 * Sending a string causes lexicographic comparison ("10" <= "6" = true).
 */
export async function syncOneSignalTags(prefs: {
  min_significance_score: number;
}, profile: {
  subscription_tier: string;
}) {
  const OneSignal = await import("react-onesignal");
  // OneSignal SDK accepts string, but server-side filter uses numeric <= comparison.
  // Passing the number as a string is correct — OneSignal parses it as numeric for tag filters.
  OneSignal.default.User.addTag("alert_score_min", String(prefs.min_significance_score));
  OneSignal.default.User.addTag("plan", profile.subscription_tier || "free");
}
