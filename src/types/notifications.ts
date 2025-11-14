export interface Notification {
  id: string;
  type: 'team_member_added' | 'task_assigned' | 'task_overdue' | 'phase_started' | 'feedback_comment' | 'feedback_status_changed' | 'feedback_submitted_bug' | 'feedback_submitted_feature';
  title: string;
  message: string;
  projectId?: string;
  projectName?: string;
  userId: string;
  createdAt: string;
  read: boolean;
  metadata?: {
    taskId?: string;
    taskName?: string;
    phaseName?: string;
    addedBy?: string;
    dueDate?: string;
    feedbackId?: string;
    feedbackType?: string;
    subject?: string;
    oldStatus?: string;
    newStatus?: string;
    commentId?: string;
    commentText?: string;
    priority?: string;
    createdBy?: string;
  };
}

export interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  lastChecked: string;
}

export type NotificationType = Notification['type'];
