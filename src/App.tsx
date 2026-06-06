import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import GlobalFocusButton from './components/GlobalFocusButton';
import Dashboard from './pages/Dashboard';
import ChainList from './pages/ChainList';
import ChainDetail from './pages/ChainDetail';
import DataManagement from './pages/DataManagement';
import AuxiliarySessionPage from './pages/AuxiliarySession';
import FocusSessionPage from './pages/FocusSession';
import History from './pages/History';
import Review from './pages/Review';
import RSIP from './pages/RSIP';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar />
        <GlobalFocusButton />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/chains" element={<ChainList />} />
            <Route path="/chains/:id" element={<ChainDetail />} />
            <Route path="/chains/:id/auxiliary" element={<AuxiliarySessionPage />} />
            <Route path="/chains/:id/focus" element={<FocusSessionPage />} />
            <Route path="/history" element={<History />} />
            <Route path="/review" element={<Review />} />
            <Route path="/rsip" element={<RSIP />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/data-management" element={<DataManagement />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
