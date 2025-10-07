import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API_BASE_URL } from '../config';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
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

  useEffect(() => {
    // Check for existing session on app load
    const checkAuth = async () => {
      const storedUser = localStorage.getItem('jaice_user');
      const token = localStorage.getItem('jaice_token');

      if (storedUser && token) {
        try {
          // Verify token with backend
          const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const userData = JSON.parse(storedUser);
            setUser(userData);
          } else if (response.status === 401) {
            // Only clear storage if token is actually invalid (401)
            console.log('Token invalid, clearing storage');
            localStorage.removeItem('jaice_user');
            localStorage.removeItem('jaice_token');
            localStorage.removeItem('jaice_vendors');
          } else {
            // For other errors (500, network issues), keep user logged in
            console.log('Server error during auth verification, keeping user logged in');
            const userData = JSON.parse(storedUser);
            setUser(userData);
          }
        } catch (error) {
          // Network error - keep user logged in rather than forcing logout
          console.log('Network error during auth verification, keeping user logged in');
          try {
            const userData = JSON.parse(storedUser);
            setUser(userData);
          } catch (parseError) {
            // Only clear if stored data is corrupted
            console.log('Corrupted user data, clearing storage');
            localStorage.removeItem('jaice_user');
            localStorage.removeItem('jaice_token');
            localStorage.removeItem('jaice_vendors');
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

  const logout = () => {
    setUser(null);
    localStorage.removeItem('jaice_user');
    localStorage.removeItem('jaice_token');
    localStorage.removeItem('jaice_vendors'); // Clear vendors cache on logout
  };

  const value = {
    user,
    login,
    logout,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

