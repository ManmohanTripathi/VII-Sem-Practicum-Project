"use client";

import { CalendarClock, HeartPulse, LayoutDashboard, Mail, MessageCircle, Settings, Users } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";

export function ElderTabs({ elderId, openAlerts, unheard = 0 }: { elderId: string; openAlerts: number; unheard?: number }) {
  const base = `/elders/${elderId}`;
  return (
    <Tabs
      items={[
        { href: base, label: "Overview", icon: LayoutDashboard, exact: true, badge: openAlerts },
        { href: `${base}/messages`, label: "Messages", icon: Mail, badge: unheard },
        { href: `${base}/reminders`, label: "Reminders", icon: CalendarClock },
        { href: `${base}/conversations`, label: "Conversations", icon: MessageCircle },
        { href: `${base}/health`, label: "Health & home", icon: HeartPulse },
        { href: `${base}/family`, label: "Family", icon: Users },
        { href: `${base}/settings`, label: "Settings", icon: Settings },
      ]}
    />
  );
}
