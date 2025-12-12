import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import App from './App'
import { useAuth } from './contexts/AuthContext'

export default function AppRouter() {
	const { user } = useAuth()
	const isAdmin = user?.role === 'admin'

	return (
		<Routes>
			<Route path="/" element={<App />} />
			<Route path="/home" element={<App />} />
			<Route path="/project-hub/*" element={<App />} />
			<Route path="/vendor-library" element={<App />} />
			<Route path="/content-analysis/*" element={<App />} />
			<Route path="/transcripts/*" element={<App />} />
			<Route path="/storytelling/*" element={<App />} />
			<Route path="/stat-testing" element={<App />} />
			<Route path="/open-end-coding" element={<App />} />
			<Route path="/data-tabulation/*" element={<App />} />
			<Route path="/tabs/*" element={<App />} />
			<Route path="/conjoint-simulator/*" element={<App />} />
			<Route path="/admin-center/*" element={<App />} />
			<Route path="/feedback/*" element={<App />} />
			<Route path="/qnr/*" element={<App />} />
			<Route path="/data-quality/*" element={isAdmin ? <App /> : <Navigate to="/home" replace />} />
			<Route path="/data-quality-v2/*" element={isAdmin ? <App /> : <Navigate to="/home" replace />} />
		</Routes>
	)
}


