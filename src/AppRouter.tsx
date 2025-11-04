import React from 'react'
import { Routes, Route } from 'react-router-dom'
import App from './App'

export default function AppRouter() {
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
			<Route path="/tab-testing" element={<App />} />
			<Route path="/conjoint-simulator/*" element={<App />} />
			<Route path="/admin-center/*" element={<App />} />
			<Route path="/feedback/*" element={<App />} />
			<Route path="/qnr/*" element={<App />} />
		</Routes>
	)
}


