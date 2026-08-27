import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

function TabIcon({ path }: { path: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-6 w-6 shrink-0"
    >
      {path}
    </svg>
  );
}

const TABS = [
  {
    to: "/home",
    label: "Home",
    icon: (
      <>
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M9 22V12h6v10" />
      </>
    ),
  },
  {
    to: "/library",
    label: "Library",
    icon: (
      <>
        <path d="m16 6 4 14M12 6v14M8 8v12M4 4v16" />
      </>
    ),
  },
  {
    to: "/settings",
    label: "Settings",
    icon: (
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
];

export default function BottomTabs() {
  return (
    <nav
      aria-label="Primary"
      data-testid="bottom-tabs"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-hairline bg-surface pb-[var(--sc-safe-bottom)] h-[calc(4rem+var(--sc-safe-bottom))]"
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          data-testid={`tab-${tab.label.toLowerCase()}`}
          className={({ isActive }) =>
            `flex min-w-[48px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-[var(--sc-dur-fast)] ease-out ${
              isActive ? "text-accent" : "text-text-2"
            }`
          }
        >
          <TabIcon path={tab.icon} />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
