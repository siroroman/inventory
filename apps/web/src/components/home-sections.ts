import {
  Building2,
  BriefcaseBusiness,
  ClipboardCheck,
  Image,
  type LucideIcon,
  QrCode,
  Wrench,
} from 'lucide-react';

/** The sections of Home, in menu order: tabs in the URL (`?tab=`; locations is the one left out). */
export const homeTabs = ['locations', 'items', 'maintenance', 'suppliers', 'inventory', 'labels'] as const;
export type HomeTab = (typeof homeTabs)[number];

/** What the side menu (desktop) and the hamburger menu (phone) list: icon and the label's i18n key. */
export const homeSections: { tab: HomeTab; icon: LucideIcon; label: `home.${HomeTab}.tab` }[] = [
  { tab: 'locations', icon: Building2, label: 'home.locations.tab' },
  { tab: 'items', icon: Image, label: 'home.items.tab' },
  { tab: 'maintenance', icon: Wrench, label: 'home.maintenance.tab' },
  { tab: 'suppliers', icon: BriefcaseBusiness, label: 'home.suppliers.tab' },
  { tab: 'inventory', icon: ClipboardCheck, label: 'home.inventory.tab' },
  { tab: 'labels', icon: QrCode, label: 'home.labels.tab' },
];
