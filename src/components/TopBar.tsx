import React, { useState, useEffect, useRef } from 'react';
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';

const BRAND = { orange: "#D14A2D" };

interface TopBarProps {
  route: string;
  onProjectCreated?: (project: any) => void;
}

const TopBar: React.FC<TopBarProps> = ({ route, onProjectCreated }) => {
  const { user, logout } = useAuth();
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowProfileDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <header className="h-16 bg-white border-b px-4 md:px-6 flex items-center gap-3">
      <div className="text-sm text-gray-500">Welcome to</div>
      <div className="font-semibold" style={{ color: BRAND.orange }}>
        Cognitive Dash
      </div>
      <div className="ml-2 text-gray-400">/</div>
      <div className="text-gray-800 font-medium">{route}</div>
      <div className="ml-auto flex items-center gap-3">
        {/* User Profile Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowProfileDropdown(!showProfileDropdown)}
            className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-50 transition-colors"
          >
            <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-bold">
                {user?.name?.charAt(0) || 'U'}
              </span>
            </div>
            <div className="hidden md:block text-left">
              <div className="text-sm font-medium text-gray-900">
                {user?.name || 'User'}
              </div>
              <div className="text-xs text-gray-500">
                {user?.role === 'admin' ? 'Administrator' : 'User'}
              </div>
            </div>
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown Menu */}
          {showProfileDropdown && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              <div className="px-4 py-2 border-b border-gray-100">
                <div className="text-sm font-medium text-gray-900">{user?.name || 'User'}</div>
                <div className="text-xs text-gray-500">{user?.email || 'user@example.com'}</div>
              </div>
              <button
                onClick={() => {
                  logout();
                  setShowProfileDropdown(false);
                }}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
              >
                <ArrowRightOnRectangleIcon className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopBar;
