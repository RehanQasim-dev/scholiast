import { FileText, Globe, Library, PanelLeft, Type } from "lucide-react";

export interface TabletVerticalDockProps {
  hasArticle: boolean;
  viewMode: "web" | "reader";
  onToggleViewMode?: () => void;
  onLibraryToggle?: () => void;
  annotationsCount?: number;
  annotationsOpen?: boolean;
  onToggleAnnotations?: () => void;
  onOpenAppearance?: () => void;
  active?: "library" | "annotations" | null;
}

export default function TabletVerticalDock({
  hasArticle,
  viewMode,
  onToggleViewMode,
  onLibraryToggle,
  annotationsCount = 0,
  annotationsOpen = false,
  onToggleAnnotations,
  onOpenAppearance,
}: TabletVerticalDockProps) {
  return (
    <nav
      aria-label="Reader tools"
      data-testid="tablet-vertical-dock"
      className="hidden lg:flex w-[56px] shrink-0 flex-col items-center gap-1 border-r border-hairline bg-surface py-3"
    >
      <button
        type="button"
        aria-label="Open library"
        data-testid="tablet-dock-library"
        onClick={onLibraryToggle}
        className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-text-2 transition-colors hover:bg-elevated hover:text-text"
      >
        <PanelLeft size={18} strokeWidth={2} />
      </button>

      <button
        type="button"
        aria-label="Library"
        data-testid="tablet-dock-library-alt"
        onClick={onLibraryToggle}
        className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-text-2 transition-colors hover:bg-elevated hover:text-text"
      >
        <Library size={18} strokeWidth={2} />
      </button>

      <div className="my-1 h-px w-6 bg-hairline" aria-hidden />

      {hasArticle && onToggleViewMode && (
        <button
          type="button"
          aria-label={viewMode === "web" ? "Switch to clean reader" : "Switch to authentic webview"}
          data-testid="tablet-dock-viewmode"
          onClick={onToggleViewMode}
          className={`flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl transition-colors ${
            viewMode === "web"
              ? "bg-elevated text-accent ring-1 ring-accent/30"
              : "text-text-2 hover:bg-elevated hover:text-text"
          }`}
        >
          {viewMode === "web" ? <Globe size={16} strokeWidth={2} /> : <FileText size={16} strokeWidth={2} />}
        </button>
      )}

      {hasArticle && onOpenAppearance && (
        <button
          type="button"
          aria-label="Appearance"
          data-testid="tablet-dock-appearance"
          onClick={onOpenAppearance}
          className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-text-2 transition-colors hover:bg-elevated hover:text-text"
        >
          <Type size={18} strokeWidth={2} />
        </button>
      )}

      {hasArticle && onToggleAnnotations && (
        <button
          type="button"
          aria-label="Toggle annotations"
          data-testid="tablet-dock-annotations"
          onClick={onToggleAnnotations}
          className={`relative flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl transition-colors ${
            annotationsOpen
              ? "bg-accent text-[var(--sc-accent-contrast)] shadow-sm"
              : "text-text-2 hover:bg-elevated hover:text-text"
          }`}
        >
          <FileText size={18} strokeWidth={2} />
          {annotationsCount > 0 && (
            <span
              className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold leading-none ${
                annotationsOpen ? "bg-white text-accent" : "bg-accent text-[var(--sc-accent-contrast)]"
              }`}
            >
              {annotationsCount > 99 ? "99+" : annotationsCount}
            </span>
          )}
        </button>
      )}
    </nav>
  );
}