import { Box, Calculator, Compass, LayoutTemplate, Mail, MessageCircle, PlayCircle, Radar, Scale, Store, Target, TrendingUp, type LucideIcon } from "lucide-react";

// knowledge.json's topic icon names → lucide icons.
export const TOPIC_ICONS: Record<string, LucideIcon> = {
  compass: Compass,
  scale: Scale,
  storefront: Store,
  radar: Radar,
  box: Box,
  layout: LayoutTemplate,
  calculator: Calculator,
  target: Target,
  play: PlayCircle,
  mail: Mail,
  chat: MessageCircle,
  trend: TrendingUp,
};
