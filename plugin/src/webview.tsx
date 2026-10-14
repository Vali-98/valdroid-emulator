import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './webview/App';
import { queryClient } from './webview/api';
import './webview/styles.css';

const root = document.getElementById('root');
if (root) {
	createRoot(root).render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
}
