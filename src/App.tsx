import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import GlobalFocusButton from './components/GlobalFocusButton';
import Dashboard from './pages/Dashboard';
import ChainList from './pages/ChainList';
import ChainDetail from './pages/ChainDetail';
import DataManagement from './pages/DataManagement';
import AuxiliarySessionPage from './pages/AuxiliarySession';
import FocusSessionPage from './pages/FocusSession';
import History from './pages/History';
import Policies from './pages/Policies';
import PoliciesTree from './pages/PoliciesTree';
import PoliciesLibrary from './pages/PoliciesLibrary';
import PoliciesReview from './pages/PoliciesReview';
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
            <Route path="/review" element={<Navigate to="/?view=chains" replace />} />
            <Route path="/policies" element={<Policies />}>
              <Route index element={<Navigate to="tree" replace />} />
              <Route path="tree" element={<PoliciesTree />} />
              <Route path="library" element={<PoliciesLibrary />} />
              <Route path="review" element={<PoliciesReview />} />
            </Route>
            <Route path="/settings" element={<Settings />} />
            <Route path="/data-management" element={<DataManagement />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
