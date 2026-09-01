import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

const TOOLS_URL = 'https://apps.heimtech.cloud';

type DevShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  actions?: ReactNode;
};

export function DevShell({ title, subtitle, children, actions }: DevShellProps) {
  return (
    <div className="page">
      <div className="frame frame-wide app-frame">
        <header className="top">
          <div className="brand-group">
            <span className="brand-mark" aria-hidden="true" />
            <div>
              <p className="brand-title">{title}</p>
              <p className="brand-sub">{subtitle}</p>
            </div>
          </div>
          <div className="top-actions">
            <a className="tools-link" href={TOOLS_URL} target="_blank" rel="noopener noreferrer">
              Tools
            </a>
            <span className="pill">Developer</span>
            {actions}
            <ThemeToggle />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
