import { api, API_BASE } from "./api";

export interface ResourceFolder {
  id: string;
  name: string;
  kind: "training" | "documents" | "both";
  sort_order: number;
  created_at?: string;
}

export interface TrainingMaterial {
  id: string;
  title: string;
  category: string;
  folder_id: string | null;
  folder_name?: string;
  description: string;
  video_url: string;
  visible_positions: string[];
  created_at: string;
}

export interface DocumentItem {
  id: string;
  title: string;
  category: string;
  folder_id: string | null;
  folder_name?: string;
  description: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  visible_positions: string[];
  allow_download: boolean;
  allow_copy: boolean;
  created_at: string;
}

export async function fetchFolders(kind?: string): Promise<ResourceFolder[]> {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  const data = await api<ResourceFolder[]>(`/resource-folders/${q}`);
  // Also include "both" when filtering by training/documents
  if (kind && kind !== "both") {
    const both = await api<ResourceFolder[]>(`/resource-folders/?kind=both`);
    const map = new Map<string, ResourceFolder>();
    for (const f of [...data, ...both]) map.set(f.id, f);
    return Array.from(map.values()).sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );
  }
  return data;
}

export async function createFolder(body: Partial<ResourceFolder>) {
  return api<ResourceFolder>("/resource-folders/", { method: "POST", body });
}

export async function updateFolder(id: string, body: Partial<ResourceFolder>) {
  return api<ResourceFolder>(`/resource-folders/${id}/`, { method: "PATCH", body });
}

export async function deleteFolder(id: string) {
  await api(`/resource-folders/${id}/`, { method: "DELETE" });
}

export async function fetchTraining(position?: string): Promise<TrainingMaterial[]> {
  const q = position ? `?position=${encodeURIComponent(position)}` : "";
  return api<TrainingMaterial[]>(`/training/${q}`);
}

export async function createTraining(body: Partial<TrainingMaterial>) {
  return api<TrainingMaterial>("/training/", { method: "POST", body });
}

export async function updateTraining(id: string, body: Partial<TrainingMaterial>) {
  return api<TrainingMaterial>(`/training/${id}/`, { method: "PATCH", body });
}

export async function deleteTraining(id: string) {
  await api(`/training/${id}/`, { method: "DELETE" });
}

export async function fetchDocuments(position?: string): Promise<DocumentItem[]> {
  const q = position ? `?position=${encodeURIComponent(position)}` : "";
  return api<DocumentItem[]>(`/documents/${q}`);
}

export async function createDocument(body: Partial<DocumentItem>) {
  return api<DocumentItem>("/documents/", { method: "POST", body });
}

export async function updateDocument(id: string, body: Partial<DocumentItem>) {
  return api<DocumentItem>(`/documents/${id}/`, { method: "PATCH", body });
}

export async function deleteDocument(id: string) {
  await api(`/documents/${id}/`, { method: "DELETE" });
}

export async function uploadDocumentFile(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("prefix", "docs");
  fd.append("bucket", "hub-documents");
  return api<{ path: string; name: string; size: number; type: string }>("/uploads/", {
    method: "POST",
    formData: fd,
  });
}

export async function getMediaUrl(path: string): Promise<string | null> {
  try {
    const data = await api<{ url: string }>(
      `/uploads/url/?path=${encodeURIComponent(path)}`,
    );
    return data.url;
  } catch {
    return null;
  }
}

export function mediaContentUrl(path: string): string {
  return `${API_BASE.replace(/\/$/, "")}/uploads/content/?path=${encodeURIComponent(path)}`;
}

export async function deleteMedia(path: string) {
  await api("/uploads/delete/", { method: "POST", body: { path } });
}
