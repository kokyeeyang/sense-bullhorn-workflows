"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardCheck, DatabaseZap, Mail, Workflow } from "lucide-react";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Workflow Dashboard",
    description: "Run health and metrics",
    icon: BarChart3,
  },
  {
    href: "/data-enrichment",
    label: "Data Enrichment",
    description: "Old and new values",
    icon: DatabaseZap,
  },
  {
    href: "/emails",
    label: "Email Sends",
    description: "Outbound messages",
    icon: Mail,
  },
  {
    href: "/survey-responses",
    label: "Survey Responses",
    description: "Workflow feedback",
    icon: ClipboardCheck,
  },
];

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="appFrame">
      <aside className="sideNav">
        <div className="brandBlock">
          <div className="brandIcon">
            <Workflow size={22} />
          </div>
          <div>
            <strong>SO Workflows</strong>
            <span>Operations metrics</span>
          </div>
        </div>

        <nav aria-label="Dashboard pages">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link className={active ? "navItem active" : "navItem"} href={item.href} key={item.href}>
                <Icon size={19} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="appContent">{children}</div>
    </div>
  );
}
