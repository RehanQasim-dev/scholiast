interface KeyboardButtonProps {
  onClick: () => void;
}

export default function KeyboardButton({ onClick }: KeyboardButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show keyboard"
      aria-label="Focus comment field"
      className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:text-text"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-[20px] w-[20px]"
      >
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
      </svg>
    </button>
  );
}
