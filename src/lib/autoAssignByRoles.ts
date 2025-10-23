import type { TeamMemberWithRoles, Assignment } from '../types/roles';

/**
 * Given team members with selected roles, return task assignments.
 * - If multiple members share a role, tasks are round-robined across them.
 * - If no member has a role, tasks for that role remain unassigned (skipped here).
 */
export async function autoAssignByRoles(tasks: any[], team: TeamMemberWithRoles[]): Promise<Assignment[]> {
  console.log('🔍 Role map loaded:', ['Project Manager', 'Logistics', 'Recruit Coordinator', 'AE Manager']);
  
  // Build role -> memberIds map
  const roleToMembers = new Map<string, string[]>();
  team.forEach(member => {
    console.log(`👤 Processing member ${member.name} with roles:`, member.roles);
    (member.roles || []).forEach(role => {
      const list = roleToMembers.get(role) || [];
      list.push(member.id);
      roleToMembers.set(role, list);
      console.log(`📋 Added ${member.name} to role ${role}`);
    });
  });

  console.log('📋 Role to members mapping:', Array.from(roleToMembers.entries()));

  const assignments: Assignment[] = [];

  // Process tasks and assign them based on their role
  tasks.forEach(task => {
    const taskRole = task.role; // Keep original case for matching
    console.log(`🔍 Processing task ${task.id} with role: ${task.role}`);
    if (taskRole && roleToMembers.has(taskRole)) {
      const members = roleToMembers.get(taskRole) || [];
      console.log(`🎯 Role ${task.role} has ${members.length} members:`, members);
      console.log(`🎯 Role ${task.role} has ${tasks.filter(t => t.role === taskRole).length} tasks:`, tasks.filter(t => t.role === taskRole).slice(0, 5).map(t => t.id), '...');

      members.forEach(member => {
        assignments.push({
          taskId: task.id,
          assignedTo: member,
          role: task.role // Keep the original role for context
        });
        console.log(`✅ Assigned task ${task.id} to ${member} (${task.role})`);
      });
    } else {
      console.warn(`⚠️ No members have role ${task.role}, skipping ${tasks.filter(t => t.role === taskRole).length} tasks`);
    }
  });

  console.log(`🎯 Total assignments generated: ${assignments.length}`);
  return assignments;
}

/**
 * Filter tasks by methodology type (Quant/Qual)
 */
export function filterTasksByMethodology(tasks: any[], methodologyType: string): any[] {
  if (!methodologyType) return tasks;
  
  return tasks.filter(task => {
    // If task has quantQual field, match it
    if (task.quantQual) {
      return task.quantQual.toLowerCase() === methodologyType.toLowerCase();
    }
    // If no quantQual field, include the task (for backward compatibility)
    return true;
  });
}

