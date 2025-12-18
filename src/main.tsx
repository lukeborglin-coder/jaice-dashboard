import React from 'react'
import ReactDOM from 'react-dom/client'
import AppRouter from './AppRouter'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/Toast'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
		<AuthProvider>
			<ToastProvider>
				<BrowserRouter>
					<AppRouter />
				</BrowserRouter>
			</ToastProvider>
		</AuthProvider>
  </React.StrictMode>,
)
