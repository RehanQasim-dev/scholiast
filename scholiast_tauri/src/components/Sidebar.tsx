import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

function NavIcon({ path }: { path: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[18px] w-[18px] shrink-0"
    >
      {path}
    </svg>
  );
}

const NAV_ITEMS = [
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
    to: "/player",
    label: "Player",
    icon: <path d="m6 3 14 9-14 9z" />,
  },
  {
    to: "/reader",
    label: "Reader",
    icon: (
      <>
        <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
        <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
      </>
    ),
  },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-[var(--sc-dur-fast)] ease-out ${
    isActive ? "bg-elevated text-text" : "text-text-2 hover:bg-elevated/60 hover:text-text"
  }`;

export default function Sidebar() {
  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-hairline bg-surface">
      <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className={linkClass}>
            <NavIcon path={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
