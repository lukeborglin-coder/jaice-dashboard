import React, { useState, useEffect, useRef } from 'react';
import { BellIcon, UserGroupIcon, ClipboardDocumentListIcon, ExclamationTriangleIcon, RocketLaunchIcon } from '@heroicons/react/24/outline';
import { Notification } from '../types/notifications';

interface NotificationBellProps {
  notifications: Notification[];
  unreadCount: number;
  onNotificationClick: (notification: Notification) => void;
  onViewAllNotifications: () => void;
  onMarkAsRead: () => void;
}

const BRAND_ORANGE = '#D14A2D';

export default function NotificationBell({
  notifications,
  unreadCount,
  onNotificationClick,
  onViewAllNotifications,
  onMarkAsRead
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Mark as read when dropdown opens
  useEffect(() => {
    if (isOpen && unreadCount > 0) {
      onMarkAsRead();
    }
  }, [isOpen, unreadCount, onMarkAsRead]);

  const handleBellClick = () => {
    setIsOpen(!isOpen);
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'team_member_added':
        return <UserGroupIcon className="w-5 h-5 text-blue-500" />;
      case 'task_assigned':
        return <ClipboardDocumentListIcon className="w-5 h-5 text-green-500" />;
      case 'task_overdue':
        return <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />;
      case 'phase_started':
        return <RocketLaunchIcon className="w-5 h-5 text-purple-500" />;
      default:
        return <BellIcon className="w-5 h-5 text-gray-500" />;
    }
  };

  const latestNotifications = notifications.slice(0, 5);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Icon with Badge */}
      <button
        onClick={handleBellClick}
        className="relative w-10 h-10 flex items-center justify-center hover:opacity-80 transition-opacity text-gray-400 hover:text-gray-600"
      >
        {/* Bell SVG */}
        <svg className="bell-regular w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
          <path fill="currentColor" d="M224 0c-17.7 0-32 14.3-32 32V49.9C119.5 61.4 64 124.2 64 200v33.4c0 45.4-15.5 89.5-43.8 124.9L5.3 377c-5.8 7.2-6.9 17.1-2.9 25.4S14.8 416 24 416H424c9.2 0 17.6-5.3 21.6-13.6s2.9-18.2-2.9-25.4l-14.9-18.6C399.5 322.9 384 278.8 384 233.4V200c0-75.8-55.5-138.6-128-150.1V32c0-17.7-14.3-32-32-32zm0 96h8c57.4 0 104 46.6 104 104v33.4c0 47.9 13.9 94.6 39.7 134.6H72.3C98.1 328 112 281.3 112 233.4V200c0-57.4 46.6-104 104-104h8zm64 352H224 160c0 17 6.7 33.3 18.7 45.3s28.3 18.7 45.3 18.7s33.3-6.7 45.3-18.7s18.7-28.3 18.7-45.3z"></path>
        </svg>

        {/* Notification Badge */}
        {unreadCount > 0 && (
          <span 
            className="absolute -top-1 -right-1 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold"
            style={{ backgroundColor: BRAND_ORANGE, fontSize: '10px' }}
          >
            {unreadCount > 5 ? '5+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-xs text-gray-500">{unreadCount} unread</span>
              )}
            </div>
          </div>

          {/* Notifications List */}
          <div className="max-h-80 overflow-y-auto">
            {latestNotifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-gray-500 text-sm">
                No notifications yet
              </div>
            ) : (
              latestNotifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => {
                    onNotificationClick(notification);
                    setIsOpen(false);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-1">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {notification.title}
                          </p>
                          {!notification.read && (
                            <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></div>
                          )}
                        </div>
                        <span className="text-xs text-gray-400">
                          {formatTimeAgo(notification.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-1">
                        {notification.projectName}
                      </p>
                      <p className="text-xs text-gray-600 line-clamp-1">
                        {notification.message}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 5 && (
            <div className="border-t border-gray-100">
              <button
                onClick={() => {
                  onViewAllNotifications();
                  setIsOpen(false);
                }}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
              >
                <span>View all notifications</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        .bell-regular {
          animation: keyframes-fill 0.5s;
        }

        @keyframes keyframes-fill {
          0% {
            opacity: 0;
          }
          25% {
            transform: rotate(25deg);
          }
          50% {
            transform: rotate(-20deg) scale(1.2);
          }
          75% {
            transform: rotate(15deg);
          }
        }
      `}</style>
    </div>
  );
}
