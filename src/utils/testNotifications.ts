import { notificationService } from '../services/notificationService';

// Test function to generate sample notifications
export const generateTestNotifications = (userId: string) => {
  // Clear existing notifications first
  localStorage.removeItem('jaice_notifications');
  
  // Generate sample notifications
  notificationService.generateTeamMemberNotification(
    'test-project-1',
    'Sample Project Alpha',
    userId,
    'Test User',
    'Project Manager'
  );
  
  notificationService.generateTaskAssignedNotification(
    'test-project-1',
    'Sample Project Alpha',
    userId,
    'task-001',
    'Review survey questions',
    '2024-01-15'
  );
  
  notificationService.generateOverdueTaskNotification(
    'test-project-2',
    'Sample Project Beta',
    userId,
    'task-002',
    'Complete data analysis',
    '2024-01-10'
  );
  
  notificationService.generatePhaseStartedNotification(
    'test-project-1',
    'Sample Project Alpha',
    userId,
    'Analysis Phase'
  );
  
  notificationService.generateTaskAssignedNotification(
    'test-project-3',
    'Sample Project Gamma',
    userId,
    'task-003',
    'Prepare presentation',
    '2024-01-20'
  );
  
  console.log('✅ Test notifications generated');
};
