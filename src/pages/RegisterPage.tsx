import React, { lazy, Suspense } from 'react'
const Register = lazy(() => import('../components/Register'))

export default function RegisterPage() {
	return (
		<Suspense fallback={<div>Loading…</div>}>
			<Register />
		</Suspense>
	)
}


