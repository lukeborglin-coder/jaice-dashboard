import { API_BASE_URL } from '../config';
import React, { useState, useEffect, useRef } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

// Helper function for getting member color (consistent across all contexts)
const getMemberColor = (memberId: string) => {
  const colors = [
    '#3B82F6', // Blue
    '#10B981', // Green
    '#F59E0B', // Yellow
    '#EF4444', // Red
    '#8B5CF6', // Purple
    '#06B6D4', // Cyan
    '#F97316', // Orange
    '#84CC16', // Lime
    '#EC4899', // Pink
    '#6B7280'  // Gray
  ];
  
  // Use only memberId for consistent colors across all contexts
  // This ensures the same person always gets the same color regardless of project
  const identifier = memberId;
  
  // Simple hash function to get consistent color for each member
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    const char = identifier.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return colors[Math.abs(hash) % colors.length];
};

interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

interface UserSearchProps {
  onUserSelect: (user: User) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const UserSearch: React.FC<UserSearchProps> = ({ 
  onUserSelect, 
  placeholder = "Search users...", 
  className = "",
  disabled = false 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchTerm.length >= 1) {
        searchUsers(searchTerm);
      } else {
        setSearchResults([]);
        setShowDropdown(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchUsers = async (query: string) => {
    if (!query.trim()) return;

    console.log('Searching for users with query:', query);
    setIsLoading(true);
    try {
      const token = localStorage.getItem('cognitive_dash_token');
      console.log('Token:', token ? 'Present' : 'Missing');
      console.log('Token length:', token ? token.length : 0);
      
      const url = `${API_BASE_URL}/api/auth/users/search?q=${encodeURIComponent(query)}`;
      console.log('Request URL:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);

      if (response.ok) {
        const data = await response.json();
        console.log('Search results:', data);
        setSearchResults(data.users || []);
        setShowDropdown(true);
      } else {
        const errorText = await response.text();
        console.error('Failed to search users:', response.status, errorText);
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Error searching users:', error);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUserSelect = (user: User) => {
    onUserSelect(user);
    setSearchTerm('');
    setSearchResults([]);
    setShowDropdown(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleInputFocus = () => {
    if (searchResults.length > 0) {
      setShowDropdown(true);
    }
  };

  return (
    <div ref={searchRef} className={`relative ${className}`}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300 disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        {isLoading && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500"></div>
          </div>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && searchResults.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {searchResults.map((user) => (
            <button
              key={user.id}
              onClick={() => handleUserSelect(user)}
              className="w-full px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium" style={{ backgroundColor: getMemberColor(user.id) }}>
                  {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">{user.name}</div>
                  <div className="text-xs text-gray-500">{user.email}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No results */}
      {showDropdown && searchResults.length === 0 && searchTerm.length >= 1 && !isLoading && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg">
          <div className="px-4 py-3 text-sm text-gray-500 text-center">
            No users found
          </div>
        </div>
      )}
    </div>
  );
};

export default UserSearch;
