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

  return <>{children}</>;
};

export default AuthWrapper;
