import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import Photos from './pages/Photos';
import Duplicates from './pages/Duplicates';
import Settings from './pages/Settings';
import Benchmarks from './pages/Benchmarks';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="photos" element={<Photos />} />
        <Route path="duplicates" element={<Duplicates />} />
        <Route path="benchmarks" element={<Benchmarks />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
