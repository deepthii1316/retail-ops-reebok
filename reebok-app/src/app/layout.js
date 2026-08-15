import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata = {
  title: 'VS Corp Reebok — Data Upload Portal',
  description: 'Upload and manage retail data reports for VS Corp Reebok store. Medallion pipeline — files are renamed, hashed, and stored in the raw layer.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app-layout">
          <Sidebar />
          <main className="main-content">
            {/* Top Bar */}
            <div className="top-bar">
              <div className="top-bar-left">
                <h2>VS Corp</h2>
                <p>Reebok Retail Analytics</p>
              </div>
              <div className="top-bar-right">
                <div className="user-badge">
                  <div className="user-avatar">A</div>
                  <div className="user-info">
                    <span className="user-name">Admin</span>
                    <span className="user-role">admin@vscorp.in</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Page content */}
            <div className="page-content">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
