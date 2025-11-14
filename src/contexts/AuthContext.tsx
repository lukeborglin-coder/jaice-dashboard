import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API_BASE_URL } from '../config';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'oversight';
  company?: 'None' | 'Cognitive';
}

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const inactivityTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const INACTIVITY_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

  const logout = React.useCallback(() => {
    setUser(null);
    localStorage.removeItem('cognitive_dash_user');
    localStorage.removeItem('cognitive_dash_token');
    localStorage.removeItem('cognitive_dash_vendors'); // Clear vendors cache on logout
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }
  }, []);

  // Reset inactivity timer
  const resetInactivityTimer = React.useCallback(() => {
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }

    if (user) {
      inactivityTimeoutRef.current = setTimeout(() => {
        console.log('⏰ User inactive for 2 hours, logging out...');
        logout();
        alert('You have been logged out due to inactivity. Please log in again.');
      }, INACTIVITY_TIMEOUT);
    }
  }, [user, logout]);

  // Track user activity
  useEffect(() => {
    if (!user) {
      // Clear timer if user is not logged in
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
        inactivityTimeoutRef.current = null;
      }
      return;
    }

    // Set initial timer
    resetInactivityTimer();

    // Track various user activities
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    const handleActivity = () => {
      resetInactivityTimer();
    };

    // Add event listeners
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Cleanup
    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
    };
  }, [user, resetInactivityTimer]);

  useEffect(() => {
    // Check for existing session on app load
    const checkAuth = async () => {
      const storedUser = localStorage.getItem('cognitive_dash_user');
      const token = localStorage.getItem('cognitive_dash_token');

      if (storedUser && token) {
        try {
          console.log('🔐 Verifying token with backend:', API_BASE_URL);
          // Verify token with backend
          const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          console.log('📡 Auth verification response:', response.status, response.statusText);
          
          if (response.ok) {
            console.log('✅ Token verified successfully');
            const userData = JSON.parse(storedUser);
            setUser(userData);
          } else if (response.status === 401) {
            // Only clear storage if token is actually invalid (401)
            console.log('❌ Token invalid, clearing storage');
            localStorage.removeItem('cognitive_dash_user');
            localStorage.removeItem('cognitive_dash_token');
            localStorage.removeItem('cognitive_dash_vendors');
          } else {
            // For other errors (500, network issues), keep user logged in
            console.log('⚠️ Server error during auth verification, keeping user logged in. Status:', response.status);
            const userData = JSON.parse(storedUser);
            setUser(userData);
          }
        } catch (error) {
          // Network error - keep user logged in rather than forcing logout
          console.log('🌐 Network error during auth verification, keeping user logged in:', error);
          try {
            const userData = JSON.parse(storedUser);
            setUser(userData);
          } catch (parseError) {
            // Only clear if stored data is corrupted
            console.log('💥 Corrupted user data, clearing storage:', parseError);
            localStorage.removeItem('cognitive_dash_user');
            localStorage.removeItem('cognitive_dash_token');
            localStorage.removeItem('cognitive_dash_vendors');
          }
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = (userData: User) => {
    setUser(userData);
  };

  const value = {
    user,
    login,
    logout,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

