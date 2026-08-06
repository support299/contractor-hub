import { api } from "./api";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface LeaveApproval {
  submission_id: string;
  status: ApprovalStatus;
  decided_at: string | null;
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
