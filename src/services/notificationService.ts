import { Notification, NotificationType } from '../types/notifications';

export class NotificationService {
  private static instance: NotificationService;
  private notifications: Notification[] = [];
  private listeners: ((notifications: Notification[]) => void)[] = [];

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  // Load notifications from localStorage
  loadNotifications(): Notification[] {
    try {
      const stored = localStorage.getItem('jaice_notifications');
      if (stored) {
        this.notifications = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
      this.notifications = [];
    }
    return this.notifications;
  }

  // Save notifications to localStorage
  private saveNotifications(): void {
    try {
      localStorage.setItem('jaice_notifications', JSON.stringify(this.notifications));
    } catch (error) {
      console.error('Error saving notifications:', error);
    }
  }

  // Subscribe to notification changes
  subscribe(listener: (notifications: Notification[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Notify all listeners
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener([...this.notifications]));
  }

  // Get all notifications
  getNotifications(): Notification[] {
    return [...this.notifications];
  }

  // Get unread count
  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  // Mark notifications as read
  markAsRead(notificationIds?: string[]): void {
    if (notificationIds) {
      this.notifications = this.notifications.map(n => 
        notificationIds.includes(n.id) ? { ...n, read: true } : n
      );
    } else {
      // Mark all as read
      this.notifications = this.notifications.map(n => ({ ...n, read: true }));
    }
    this.saveNotifications();
    this.notifyListeners();
  }

  // Create a new notification
  createNotification(
    type: NotificationType,
    title: string,
    message: string,
    projectId: string,
    projectName: string,
    userId: string,
    metadata?: Notification['metadata']
  ): Notification {
    const notification: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      projectId,
      projectName,
      userId,
      createdAt: new Date().toISOString(),
      read: false,
      metadata
    };

    this.notifications.unshift(notification); // Add to beginning
    
    // Keep only the latest 20 notifications
    if (this.notifications.length > 20) {
      this.notifications = this.notifications.slice(0, 20);
    }
    
    this.saveNotifications();
    this.notifyListeners();
    return notification;
  }

  // Generate notification for team member added
  generateTeamMemberNotification(
    projectId: string,
    projectName: string,
    addedUserId: string,
    addedUserName: string,
    addedBy: string,
    currentPhase?: string
  ): void {
    this.createNotification(
      'team_member_added',
      'Added to Project Team',
      `You've been added as a team member by ${addedBy}`,
      projectId,
      projectName,
      addedUserId,
      { addedBy, phaseName: currentPhase }
    );
  }

  // Generate notification for task assigned
  generateTaskAssignedNotification(
    projectId: string,
    projectName: string,
    assignedUserId: string,
    taskId: string,
    taskName: string,
    dueDate?: string,
    currentPhase?: string
  ): void {
    this.createNotification(
      'task_assigned',
      'New Task Assigned',
      `You've been assigned a new task: "${taskName}"`,
      projectId,
      projectName,
      assignedUserId,
      { taskId, taskName, dueDate, phaseName: currentPhase }
    );
  }

  // Generate notification for overdue task
  generateOverdueTaskNotification(
    projectId: string,
    projectName: string,
    userId: string,
    taskId: string,
    taskName: string,
    dueDate: string,
    currentPhase?: string
  ): void {
    this.createNotification(
      'task_overdue',
      'Task Overdue',
      `Your task "${taskName}" is overdue (due: ${new Date(dueDate).toLocaleDateString()})`,
      projectId,
      projectName,
      userId,
      { taskId, taskName, dueDate, phaseName: currentPhase }
    );
  }

  // Generate notification for phase started
  generatePhaseStartedNotification(
    projectId: string,
    projectName: string,
    userId: string,
    phaseName: string
  ): void {
    this.createNotification(
      'phase_started',
      'New Phase Started',
      `A new phase "${phaseName}" has started`,
      projectId,
      projectName,
      userId,
      { phaseName }
    );
  }

  // Check for overdue tasks (should be called periodically)
  checkOverdueTasks(projects: any[], currentUserId: string): void {
    const now = new Date();
    
    projects.forEach(project => {
      if (project.tasks && Array.isArray(project.tasks)) {
        project.tasks.forEach((task: any) => {
          if (task.assignedTo === currentUserId && task.dueDate && !task.completed) {
            const dueDate = new Date(task.dueDate);
            if (dueDate < now) {
              // Check if we already have an overdue notification for this task
              const existingNotification = this.notifications.find(n => 
                n.type === 'task_overdue' && 
                n.metadata?.taskId === task.id && 
                !n.read
              );
              
              if (!existingNotification) {
                this.generateOverdueTaskNotification(
                  project.id,
                  project.name,
                  currentUserId,
                  task.id,
                  task.name,
                  task.dueDate
                );
              }
            }
          }
        });
      }
    });
  }

  // Clear old notifications (keep last 20)
  cleanupOldNotifications(): void {
    if (this.notifications.length > 20) {
      this.notifications = this.notifications
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 20);
      this.saveNotifications();
      this.notifyListeners();
    }
  }
}

export const notificationService = NotificationService.getInstance();
