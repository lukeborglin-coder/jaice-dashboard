import React, { useState, useEffect } from 'react';
import { 
  BellIcon, 
  XMarkIcon, 
  CheckIcon,
  ClockIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  RocketLaunchIcon
} from '@heroicons/react/24/outline';
import { Notification } from '../types/notifications';

interface NotificationCenterProps {
  notifications: Notification[];
  onNotificationClick: (notification: Notification) => void;
  onMarkAllAsRead: () => void;
  onClose: () => void;
}

const BRAND_ORANGE = '#D14A2D';
const BRAND_BG = '#F7F7F8';
const BRAND_GRAY = '#5D5F62';

// Phase colors matching the project system
const PHASE_COLORS: Record<string, string> = {
  'Kickoff': '#6B7280',        // Grey
  'Pre-Field': '#1D4ED8',      // Blue
  'Fielding': '#7C3AED',       // Purple
  'Post-Field Analysis': '#F97316', // Orange
  'Reporting': '#DC2626',      // Red
  'Complete': '#10B981',       // Green
  'Awaiting KO': '#9CA3AF'     // Neutral grey
};

export default function NotificationCenter({
  notifications,
  onNotificationClick,
  onMarkAllAsRead,
  onClose
}: NotificationCenterProps) {
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');

  const filteredNotifications = notifications
    .sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return sortBy === 'newest' ? dateB - dateA : dateA - dateB;
    })
    .slice(0, 20); // Show last 20 notifications

  // Delete excess notifications (keep only 20)
  React.useEffect(() => {
    if (notifications.length > 20) {
      const sortedNotifications = [...notifications].sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA; // Keep newest 20
      });
      const notificationsToKeep = sortedNotifications.slice(0, 20);
      // This would need to be handled by the notification service
      // For now, we'll just display the first 20
    }
  }, [notifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

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

  const getNotificationTypeLabel = (type: string) => {
    switch (type) {
      case 'team_member_added':
        return 'Team Member Added';
      case 'task_assigned':
        return 'Task Assigned';
      case 'task_overdue':
        return 'Task Overdue';
      case 'phase_started':
        return 'Phase Started';
      default:
        return 'Notification';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <BellIcon className="w-6 h-6" style={{ color: BRAND_ORANGE }} />
            <h2 className="text-xl font-semibold text-gray-900">Notification Center</h2>
            {unreadCount > 0 && (
              <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded-full">
                {unreadCount} unread
              </span>
            )}
            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest')}
              className="text-sm border border-gray-300 rounded-md px-3 py-1 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllAsRead}
                className="flex items-center gap-2 px-3 py-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                <CheckIcon className="w-4 h-4" />
                Mark all as read
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>


        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto">
          {filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <BellIcon className="w-12 h-12 mb-4 text-gray-300" />
              <p className="text-lg font-medium">No notifications</p>
              <p className="text-sm">
                You haven't received any notifications yet.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredNotifications.map((notification) => {
                // Get the current phase for the project (this would need to be passed in or calculated)
                const currentPhase = notification.metadata?.phaseName || 'Kickoff';
                const phaseColor = PHASE_COLORS[currentPhase] || PHASE_COLORS['Kickoff'];
                
                return (
                  <button
                    key={notification.id}
                    onClick={() => onNotificationClick(notification)}
                    className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-1">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-gray-900 truncate">
                              {notification.title}
                            </h3>
                            {!notification.read && (
                              <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></div>
                            )}
                            <span className="text-xs text-gray-500">
                              {notification.projectName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <ClockIcon className="w-3 h-3" />
                            <span>{formatTimeAgo(notification.createdAt)}</span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {notification.message}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <p className="text-xs text-gray-500 text-center">
            Showing {filteredNotifications.length} of {notifications.length} notifications
          </p>
        </div>
      </div>
    </div>
  );
}
