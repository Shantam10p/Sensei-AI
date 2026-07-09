// src/api/index.ts
import type { AuthResponse, LoginRequest, SignupRequest } from "../types/auth";
import type { Course } from "../types/course";
import type { DashboardStats } from "../types/dashboard";
import type {
  PlannerGenerateRequest,
  PlannerGenerateResponse,
} from "../types/planner";
import type {
  ChatHistoryResponse,
  SenseiChatMessage,
  SenseiContentResponse,
  SenseiSource,
} from "../types/sensei";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api/v1";

function buildAuthHeaders(contentType = false): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return {
    ...(contentType ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function signupUser(payload: SignupRequest): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to sign up (status ${response.status})`);
  }

  return response.json();
}

export async function loginUser(payload: LoginRequest): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to login (status ${response.status})`);
  }

  return response.json();
}

export async function fetchCourses(): Promise<Course[]> {
  const response = await fetch(`${API_BASE_URL}/courses`, {
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch courses (status ${response.status})`);
  }

  return response.json();
}

export async function fetchCourse(courseId: number): Promise<Course> {
  const response = await fetch(`${API_BASE_URL}/courses/${courseId}`, {
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch course (status ${response.status})`);
  }

  return response.json();
}

export async function fetchCoursePlan(
  courseId: number,
): Promise<PlannerGenerateResponse> {
  const response = await fetch(`${API_BASE_URL}/planner/course/${courseId}`, {
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to fetch course plan (status ${response.status})`);
  }

  return response.json();
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await fetch(`${API_BASE_URL}/study-progress/stats`, {
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to fetch dashboard stats (status ${response.status})`);
  }

  return response.json();
}

export async function completeStudyTask(taskId: number): Promise<{ task_id: number; completed: boolean }> {
  const response = await fetch(`${API_BASE_URL}/study-progress/tasks/${taskId}/complete`, {
    method: "POST",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to complete study task (status ${response.status})`);
  }

  return response.json();
}

export async function reopenStudyTask(taskId: number): Promise<{ task_id: number; completed: boolean }> {
  const response = await fetch(`${API_BASE_URL}/study-progress/tasks/${taskId}/complete`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to reopen study task (status ${response.status})`);
  }

  return response.json();
}

export async function deleteCourse(courseId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/courses/${courseId}`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to delete course (status ${response.status})`);
  }
}

export async function generatePlan(
  payload: PlannerGenerateRequest,
): Promise<PlannerGenerateResponse> {
  const response = await fetch(`${API_BASE_URL}/planner/generate-ai`, {
    method: "POST",
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (status ${response.status})`);
  }

  return response.json();
}

export async function fetchSenseiContent(payload: {
  topic: string;
  course_name: string;
  course_id: number;
}): Promise<SenseiContentResponse> {
  const response = await fetch(`${API_BASE_URL}/chat/content`, {
    method: "POST",
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to fetch Sensei content (status ${response.status})`);
  }

  return response.json();
}

export async function fetchChatHistory(taskId: number): Promise<ChatHistoryResponse> {
  const response = await fetch(`${API_BASE_URL}/chat/history/${taskId}`, {
    headers: buildAuthHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch chat history (status ${response.status})`);
  return response.json();
}

export async function saveChatMessage(payload: {
  task_id: number;
  role: string;
  content: string;
  sources?: SenseiSource[];
}): Promise<void> {
  await fetch(`${API_BASE_URL}/chat/history/message`, {
    method: "POST",
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload),
  });
}

export async function deleteChatHistory(taskId: number): Promise<void> {
  await fetch(`${API_BASE_URL}/chat/history/${taskId}`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
  });
}

export async function sendSenseiMessage(payload: {
  topic: string;
  course_name: string;
  history: SenseiChatMessage[];
  message: string;
}): Promise<{ reply: string; sources?: SenseiSource[] }> {
  const response = await fetch(`${API_BASE_URL}/chat/message`, {
    method: "POST",
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to send message (status ${response.status})`);
  }

  return response.json();
}