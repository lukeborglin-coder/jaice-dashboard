import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Login from './Login';
import Register from './Register';

interface AuthWrapperProps {
  children: React.ReactNode;
}

const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const { user, loading, login, logout } = useAuth();
  const [isLogin, setIsLogin] = useState(true);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <img src="/CogDashLogo.png" alt="Cognitive Dash Logo" className="w-40 h-40 object-contain mx-auto mb-4" />
          <div
            className="animate-spin rounded-full h-10 w-10 mx-auto border-4"
            style={{ borderColor: '#D14A2D', borderTopColor: 'transparent', borderRightColor: '#D14A2D', borderBottomColor: '#D14A2D', borderLeftColor: '#D14A2D' }}
          ></div>
          <p className="mt-4 text-gray-600">Loading Cognitive Dash Dashboard...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return isLogin ? (
      <Login 
        onLogin={login}
        onSwitchToRegister={() => setIsLogin(false)}
      />
    ) : (
      <Register 
        onRegister={login}
        onSwitchToLogin={() => setIsLogin(true)}
      />
    );
  }

  // Company-based access gating
  if ((user as any).company !== 'Cognitive' && user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white shadow rounded-lg p-8 max-w-md w-full text-center">
          <img src="/CogDashLogo.png" alt="Cognitive Dash Logo" className="w-24 h-24 object-contain mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Access Pending</h1>
          <p className="text-sm text-gray-600 mb-6">
            Your account is not yet assigned to a company. Please contact an administrator to set your company to Cognitive to access the dashboard.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2 rounded text-white"
              style={{ backgroundColor: '#D14A2D' }}
            >
              Refresh
            </button>
            <button
              onClick={logout}
              className="w-full py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AuthWrapper;
