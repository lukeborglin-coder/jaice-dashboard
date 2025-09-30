import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Login from './Login';
import Register from './Register';

interface AuthWrapperProps {
  children: React.ReactNode;
}

const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const { user, loading, login } = useAuth();
  const [isLogin, setIsLogin] = useState(true);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">J</span>
          </div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading JAICE Dashboard...</p>
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
          <img src="/Jaice_Logo_Transparent.png" alt="JAICE Logo" className="w-24 h-24 object-contain mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Access Pending</h1>
          <p className="text-sm text-gray-600 mb-6">
            Your account is not yet assigned to a company. Please contact an administrator to set your company to Cognitive to access the dashboard.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-2 rounded text-white"
            style={{ backgroundColor: '#D14A2D' }}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AuthWrapper;
