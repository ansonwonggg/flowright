import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { App } from './App.tsx';
import { EnvironmentsPage } from './pages/EnvironmentsPage.tsx';
import { FlowBuilderPage } from './pages/FlowBuilderPage.tsx';
import { FlowRunPage } from './pages/FlowRunPage.tsx';
import { FlowsPage } from './pages/FlowsPage.tsx';
import { FunctionPage } from './pages/FunctionPage.tsx';
import { HistoryPage } from './pages/HistoryPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { RecordsPage } from './pages/RecordsPage.tsx';
import { RunPage } from './pages/RunPage.tsx';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'fn/:id', element: <FunctionPage /> },
      { path: 'flows', element: <FlowsPage /> },
      { path: 'flow-builder', element: <FlowBuilderPage /> },
      { path: 'flow-run/:id', element: <FlowRunPage /> },
      { path: 'run/:id', element: <RunPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'records', element: <RecordsPage /> },
      { path: 'environments', element: <EnvironmentsPage /> },
      { path: '*', element: <div className="empty">Page not found.</div> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
