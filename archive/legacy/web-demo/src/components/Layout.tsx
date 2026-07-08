import { Outlet } from 'react-router-dom';
import Header from './Header';
import BottomNav from './BottomNav';

interface LayoutProps {
  header?: {
    title?: string;
    showBack?: boolean;
    showNotification?: boolean;
  };
  showNav?: boolean;
}

export default function Layout({ header, showNav = true }: LayoutProps) {
  return (
    <div className="flex flex-col min-h-screen">
      {header && <Header {...header} />}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {showNav && <BottomNav />}
    </div>
  );
}
