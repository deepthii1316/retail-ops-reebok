'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const navItems = [
  {
    section: 'ADMIN',
    items: [
      { href: '/upload', label: 'Data Upload', icon: '📤' },
      { href: '/history', label: 'Upload History', icon: '🕐', disabled: true },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">◆</span>
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">VS Corp</span>
          <span className="sidebar-brand-sub">Reebok</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((group) => (
          <div key={group.section} className="sidebar-section">
            <span className="sidebar-section-label">{group.section}</span>
            <ul className="sidebar-menu">
              {group.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <li key={item.href}>
                    {item.disabled ? (
                      <span className="sidebar-link disabled">
                        <span className="sidebar-link-icon">{item.icon}</span>
                        <span className="sidebar-link-label">{item.label}</span>
                        <span className="sidebar-soon-badge">Soon</span>
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        className={`sidebar-link ${isActive ? 'active' : ''}`}
                      >
                        <span className="sidebar-link-icon">{item.icon}</span>
                        <span className="sidebar-link-label">{item.label}</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">A</div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">Admin</span>
            <span className="sidebar-user-role">Administrator</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
