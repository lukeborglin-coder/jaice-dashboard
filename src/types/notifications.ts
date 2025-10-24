export interface Notification {
  id: string;
  type: 'team_member_added' | 'task_assigned' | 'task_overdue' | 'phase_started';
  title: string;
  message: string;
  projectId: string;
  projectName: string;
  userId: string;
  createdAt: string;
  read: boolean;
  metadata?: {
    taskId?: string;
    taskName?: string;
    phaseName?: string;
    addedBy?: string;
    dueDate?: string;
  };
}

export interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  lastChecked: string;
}

export type NotificationType = Notification['type'];
