import { useTheme } from '../lib/theme';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? 'Hellmodus aktivieren' : 'Dunkelmodus aktivieren'}
      title={dark ? 'Hellmodus' : 'Dunkelmodus'}
    >
      {dark ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="4.2" />
          <path
            d="M12 3v1.6M12 19.4V21M4.2 12H3M21 12h-1.6M6.1 6.1l1.1 1.1M16.8 16.8l1.1 1.1M6.1 17.9l1.1-1.1M16.8 7.2l1.1-1.1"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path
            d="M16.2 13.2A6.2 6.2 0 0 1 10.8 5.4 7 7 0 1 0 18.6 13.2a6.2 6.2 0 0 1-2.4 0Z"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
