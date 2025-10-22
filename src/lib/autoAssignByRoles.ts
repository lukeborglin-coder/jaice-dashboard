import type { TeamMemberWithRoles, Assignment } from '../types/roles';

/**
 * Given team members with selected roles, return task assignments.
 * - If multiple members share a role, tasks are round-robined across them.
 * - If no member has a role, tasks for that role remain unassigned (skipped here).
 */
export async function autoAssignByRoles(team: TeamMemberWithRoles[]): Promise<Assignment[]> {
  // Dynamic import of the role map
  const roleMapModule = await import('../data/jaice_role_task_map.json');
  const roleMap = roleMapModule.default;
  
  console.log('🔍 Role map loaded:', Object.keys(roleMap));
  
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

  // roleMap is: { [role: string]: string[] /* taskIds */ }
  Object.entries(roleMap as Record<string, string[]>).forEach(([role, taskIds]) => {
    const members = roleToMembers.get(role) || [];
    console.log(`🎯 Role ${role} has ${members.length} members:`, members);
    console.log(`🎯 Role ${role} has ${taskIds.length} tasks:`, taskIds.slice(0, 5), taskIds.length > 5 ? '...' : '');
    
    if (members.length === 0) {
      console.log(`⚠️ No members have role ${role}, skipping ${taskIds.length} tasks`);
      return; // nobody has this role
    }

    taskIds.forEach((taskId, idx) => {
      // Round-robin among members who share the role
      const assigneeId = members[idx % members.length];
      assignments.push({ taskId, assigneeId, role });
      console.log(`✅ Assigned task ${taskId} to ${assigneeId} (${role})`);
    });
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

