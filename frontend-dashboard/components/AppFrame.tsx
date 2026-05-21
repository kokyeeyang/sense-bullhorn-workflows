"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, ClipboardCheck, DatabaseZap, FileSearch, Mail, Moon, PanelsTopLeft, Sun, Workflow } from "lucide-react";

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
    href: "/email-templates",
    label: "Email Templates",
    description: "HTML catalog",
    icon: PanelsTopLeft,
  },
  {
    href: "/survey-responses",
    label: "Survey Responses",
    description: "Workflow feedback",
    icon: ClipboardCheck,
  },
  {
    href: "/candidate-reports",
    label: "Candidate Reports",
    description: "Assignment searches",
    icon: FileSearch,
  },
];

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("dashboard-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const nextTheme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : prefersDark ? "dark" : "light";

    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("dashboard-theme", nextTheme);
  }

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

        <button type="button" className="themeToggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
      </aside>

      <div className="appContent">{children}</div>
    </div>
  );
}
