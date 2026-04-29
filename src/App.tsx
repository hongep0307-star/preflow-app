import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import AuroraBackground from '@/components/AuroraBackground';
import { UiLanguageProvider } from '@/lib/uiLanguage';
import Index from './pages/Index';
import SettingsPage from './pages/SettingsPage';
import DashboardPage from './pages/DashboardPage';
import ProjectPage from './pages/ProjectPage';
import LibraryPage from './pages/LibraryPage';
import NotFound from './pages/NotFound';
import { ModeSwitcher } from '@/components/ModeSwitcher';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <UiLanguageProvider>
      <TooltipProvider>
        <Toaster />
        <AuroraBackground />
        <HashRouter>
          <div style={{ position: "relative", zIndex: 1 }}>
            <ErrorBoundary label="App">
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/library" element={<LibraryPage />} />
                  <Route path="/project/:id" element={<ProjectPage />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
              <ModeSwitcher />
            </ErrorBoundary>
          </div>
        </HashRouter>
      </TooltipProvider>
    </UiLanguageProvider>
  </QueryClientProvider>
);

export default App;
