import { api } from "./api";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface VacationSummary {
  leave_type: string;
  weekday_count: number;
  eligible: boolean | null;
  eligibility_date: string | null;
  available_vacation_days: string | null;
  employee_name: string;
  warning: string | null;
}

export interface LeaveApproval {
  submission_id: string;
  status: ApprovalStatus;
  decided_at: string | null;
  jobber_task_id?: string;
  jobber_task_synced_at?: string | null;
  jobber_sync_error?: string;
  vacation_days_deducted?: string | null;
  vacation_summary?: VacationSummary | null;
}

export async function fetchLeaveApprovals(): Promise<LeaveApproval[]> {
  return api<LeaveApproval[]>("/leave-approvals/");
}

export async function updateLeaveApproval(
  submissionId: string,
  status: ApprovalStatus,
): Promise<LeaveApproval> {
  return api<LeaveApproval>(`/leave-approvals/${submissionId}/`, {
    method: "PATCH",
    body: { status },
  });
}

export async function ensureLeaveApproval(submissionId: string): Promise<LeaveApproval> {
  return api<LeaveApproval>("/leave-approvals/ensure/", {
    method: "POST",
    body: { submission_id: submissionId },
  });
}

export async function retryJobberSync(submissionId: string): Promise<LeaveApproval> {
  return api<LeaveApproval>(`/leave-approvals/${submissionId}/retry-jobber-sync/`, {
    method: "POST",
  });
}
