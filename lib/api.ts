import axios from "axios";
import type { Session } from "next-auth";
import { getSession } from "next-auth/react";
import { BASE_URL, DASHBOARD_CATEGORY } from "@/lib/constants";
import { AxiosHeaders, type AxiosError, type InternalAxiosRequestConfig } from "axios";

export type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
};

export type User = {
  _id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "client";
  phone?: string;
  address?: string;
  bio?: string;
  avatar?: { url?: string };
  assignedProjects?: string[];
};

export type ProjectPhase = {
  phaseName: string;
  amount: number;
  dueDate: string;
  paymentStatus: "paid" | "unpaid";
  paidAt?: string | null;
  notes?: string;
};

export type ProjectProgressUpdate = {
  _id: string;
  progressName: string;
  percent: number;
  note?: string;
  updatedAt: string;
  updatedBy?: User | string | null;
};

export type Project = {
  _id: string;
  clientName: string;
  clientEmail: string;
  projectName: string;
  category: "construction" | "interior";
  phases: ProjectPhase[];
  projectBudget: number;
  totalPaid: number;
  remainingBudget: number;
  startDate: string;
  endDate: string;
  address: string;
  projectStatus: "active" | "finished";
  siteManager?: User;
  client?: User;
  clientUsers?: User[];
  progress: number;
  progressUpdates?: ProjectProgressUpdate[];
  images?: Array<{ public_id?: string; url: string }>;
  createdAt: string;
};

export type Task = {
  _id: string;
  taskName: string;
  taskDate: string;
  dueDate?: string;
  description: string;
  priority: "high" | "medium" | "low";
  status: "not-started" | "in-progress" | "completed";
  approvalStatus: "not-requested" | "pending" | "approved" | "rejected";
  project?: Pick<Project, "_id" | "projectName" | "progress">;
  createdAt: string;
};

export type DocumentItem = {
  _id: string;
  category: string;
  title: string;
  document: { url: string; public_id?: string };
  meta?: {
    fileName?: string;
    size?: number;
    mimeType?: string;
  };
  createdAt: string;
};

type DocumentCategory = "drawings" | "invoices" | "reports" | "contracts";

export type UpdateItem = {
  _id: string;
  description: string;
  images: Array<{ url: string }>;
  videos?: Array<{ url: string; thumbnailUrl?: string }>;
  uploadedBy?: User;
  stats: {
    likeCount: number;
    shareCount: number;
    commentCount: number;
  };
  createdAt: string;
};

export type CommentItem = {
  _id: string;
  comment: string;
  user?: User;
  createdAt: string;
};

export type Chat = {
  _id: string;
  title: string;
  participants: User[];
  entityType: "Project" | "Task";
};

export type Message = {
  _id: string;
  message: string;
  sender?: User;
  createdAt: string;
};

export type DashboardData = {
  summary: {
    totalProjects: number;
    finishedProjects?: number;
    activeProjects?: number;
    totalManagers?: number;
    totalClients?: number;
    pendingApprovals?: number;
  };
  financials?: {
    totalBudget: number;
    totalPaid: number;
    remainingBudget: number;
  };
};

type CreateProjectResponse = {
  project: Project;
  clientAccount: {
    isNewClient: boolean;
    email?: string;
    emails?: string[];
    count?: number;
    clients?: Array<{
      _id: string;
      name: string;
      email: string;
      category?: string;
    }>;
  };
};

type FinancialOverviewData = {
  totals: {
    totalBudget: number;
    totalPaid: number;
    remainingBalance: number;
  };
  projects: Project[];
};

type GroupedDocumentsPayload = {
  totalCount?: number;
  counts?: Partial<Record<DocumentCategory, number>>;
  documents?: Partial<Record<DocumentCategory, DocumentItem[]>>;
};

type RetryRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 20_000,
  withCredentials: true,
});

let accessTokenCache: string | null = null;
let refreshTokenCache: string | null = null;
let refreshAccessTokenPromise: Promise<string | null> | null = null;

const setAuthHeader = (config: RetryRequestConfig, token: string) => {
  if (!config.headers) {
    config.headers = new AxiosHeaders();
  }
  config.headers.set("Authorization", `Bearer ${token}`);
};

const setRefreshHeader = (config: RetryRequestConfig, token: string) => {
  if (!config.headers) {
    config.headers = new AxiosHeaders();
  }
  config.headers.set("x-refresh-token", token);
};

const loadSessionTokens = async () => {
  if (accessTokenCache || refreshTokenCache) {
    return {
      accessToken: accessTokenCache,
      refreshToken: refreshTokenCache,
    };
  }

  const session: Session | null = await getSession();
  accessTokenCache = session?.accessToken ?? null;
  refreshTokenCache = session?.refreshToken ?? null;

  return {
    accessToken: accessTokenCache,
    refreshToken: refreshTokenCache,
  };
};

const refreshAccessToken = async () => {
  if (refreshAccessTokenPromise) {
    return refreshAccessTokenPromise;
  }

  refreshAccessTokenPromise = (async () => {
    const { refreshToken } = await loadSessionTokens();
    if (!refreshToken) {
      return null;
    }

    const { data } = await axios.post<
      ApiResponse<{ accessToken: string; refreshToken?: string }>
    >(
      `${BASE_URL}/admin/dashboard/refresh-token`,
      { refreshToken },
      {
        withCredentials: true,
        timeout: 20_000,
      },
    );

    const nextAccessToken = data?.data?.accessToken ?? null;
    const nextRefreshToken = data?.data?.refreshToken ?? refreshToken;

    accessTokenCache = nextAccessToken;
    refreshTokenCache = nextRefreshToken;

    return nextAccessToken;
  })()
    .catch(() => {
      accessTokenCache = null;
      refreshTokenCache = null;
      return null;
    })
    .finally(() => {
      refreshAccessTokenPromise = null;
    });

  return refreshAccessTokenPromise;
};

http.interceptors.request.use(async (config) => {
  const requestConfig = config as RetryRequestConfig;
  const { accessToken, refreshToken } = await loadSessionTokens();

  if (accessToken) {
    setAuthHeader(requestConfig, accessToken);
  }

  if (refreshToken) {
    setRefreshHeader(requestConfig, refreshToken);
  }

  return requestConfig;
});

http.interceptors.response.use(
  (response) => {
    const nextAccessToken = response.headers?.["x-access-token"] as
      | string
      | undefined;

    if (nextAccessToken) {
      accessTokenCache = nextAccessToken;
    }

    return response;
  },
  async (error: AxiosError<{ message?: string }>) => {
    const originalConfig = error.config as RetryRequestConfig | undefined;
    const statusCode = error.response?.status;

    if (statusCode === 401 && originalConfig && !originalConfig._retry) {
      originalConfig._retry = true;

      const nextAccessToken = await refreshAccessToken();
      if (nextAccessToken) {
        setAuthHeader(originalConfig, nextAccessToken);

        if (refreshTokenCache) {
          setRefreshHeader(originalConfig, refreshTokenCache);
        }

        return http(originalConfig);
      }
    }

    const message =
      error?.response?.data?.message ||
      error?.message ||
      "Something went wrong";

    return Promise.reject(new Error(message));
  },
);

export async function forgotPassword(payload: { email: string }) {
  const { data } = await http.post<ApiResponse<null>>("/auth/forget", payload);
  return data;
}

export async function verifyOtp(payload: { email: string; otp: string }) {
  const { data } = await http.post<ApiResponse<{ email: string }>>("/auth/verify", payload);
  return data;
}

export async function resetPassword(payload: {
  email: string;
  otp: string;
  password: string;
  confirmPassword: string;
}) {
  const { data } = await http.post<ApiResponse<null>>("/auth/reset-password", payload);
  return data;
}

export async function getProfile() {
  const { data } = await http.get<ApiResponse<User>>("/user/profile");
  return data.data;
}

export async function updateProfile(payload: FormData) {
  const { data } = await http.put<ApiResponse<User>>("/user/profile", payload);
  return data;
}

export async function changePassword(payload: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) {
  const { data } = await http.put<ApiResponse<null>>("/user/password", payload);
  return data;
}

export async function getDashboard() {
  const { data } = await http.get<ApiResponse<DashboardData>>("/dashboard");
  return data.data;
}

export async function getProjects(search?: string) {
  const params: { search?: string; category: string } = {
    category: DASHBOARD_CATEGORY,
  };
  if (search) {
    params.search = search;
  }

  const { data } = await http.get<ApiResponse<Project[]>>("/projects", {
    params,
  });
  return data.data;
}

export async function getProjectDetails(projectId: string) {
  const { data } = await http.get<ApiResponse<Project>>(`/projects/${projectId}`);
  return data.data;
}

export async function createProject(
  payload:
    | FormData
    | {
        clientName: string;
        clientEmail: string;
        clientPassword: string;
        projectName: string;
        category: string;
        phases: Array<{ phaseName: string; amount: number; paymentDate: string }>;
        projectBudget: number;
        startDate: string;
        endDate: string;
        address: string;
        siteManagerId: string;
      },
) {
  const { data } = await http.post<ApiResponse<CreateProjectResponse>>("/admin/projects", payload);
  return data;
}

export async function updateProject(
  projectId: string,
  payload:
    | FormData
    | {
        clientName: string;
        projectName: string;
        category: string;
        phases: Array<{ phaseName: string; amount: number; dueDate: string }>;
        startDate: string;
        endDate: string;
        address: string;
        siteManagerId: string;
      },
) {
  const { data } = await http.patch<ApiResponse<Project>>(
    `/admin/projects/${projectId}`,
    payload,
  );
  return data;
}

export async function getManagers() {
  const { data } = await http.get<ApiResponse<User[]>>("/admin/managers", {
    params: { category: DASHBOARD_CATEGORY },
  });
  return data.data;
}

export async function getAdminProjects(params?: {
  status?: string;
  search?: string;
  manager?: string;
}) {
  const { data } = await http.get<ApiResponse<Project[]>>("/admin/projects", {
    params: {
      ...params,
      category: DASHBOARD_CATEGORY,
    },
  });
  return data.data;
}

export async function createManager(payload: FormData) {
  const { data } = await http.post<ApiResponse<User>>("/admin/managers", payload);
  return data;
}

export async function deleteManager(managerId: string) {
  const { data } = await http.delete<ApiResponse<null>>(
    `/admin/managers/${managerId}`,
  );
  return data;
}

export async function getFinancialOverview() {
  const { data } = await http.get<ApiResponse<FinancialOverviewData>>(
    "/admin/financial-overview",
    {
      params: { category: DASHBOARD_CATEGORY },
    },
  );
  return data.data;
}

export async function deleteProject(projectId: string) {
  const { data } = await http.delete<ApiResponse<null>>(
    `/admin/projects/${projectId}`,
    {
      params: { category: DASHBOARD_CATEGORY },
    },
  );
  return data;
}

export async function updatePhasePaymentStatus(
  projectId: string,
  payload: { phaseName: string; paymentStatus: "paid" | "unpaid"; notes?: string },
) {
  const { data } = await http.patch<ApiResponse<Project>>(
    `/projects/${projectId}/phase-payment`,
    payload,
  );
  return data;
}

export async function addProjectPhase(
  projectId: string,
  payload: { phaseName: string; amount: number; dueDate: string; paymentStatus?: "paid" | "unpaid"; notes?: string },
) {
  const { data } = await http.post<ApiResponse<Project>>(`/projects/${projectId}/phases`, payload);
  return data;
}

export async function syncProjectAutoProgress(projectId: string) {
  const { data } = await http.post<
    ApiResponse<{ project: Project; previousPercent: number; currentPercent: number; updated: boolean }>
  >(
    `/admin/projects/${projectId}/auto-progress`,
    {},
    {
      params: { category: DASHBOARD_CATEGORY },
    },
  );
  return data.data;
}

export async function addProjectProgress(
  projectId: string,
  payload: { progressName: string; percent?: number; note?: string; photo?: File | null },
) {
  const { data } = await http.post<ApiResponse<Project>>(
    `/projects/${projectId}/progress`,
    { progressName: payload.progressName, percent: payload.percent, note: payload.note ?? "" },
  );
  return data;
}

export async function deleteProjectProgress(
  projectId: string,
  progressUpdateId: string,
) {
  const { data } = await http.delete<ApiResponse<Project>>(
    `/projects/${projectId}/progress/${progressUpdateId}`,
  );
  return data;
}

export async function updateProjectProgress(
  projectId: string,
  progressUpdateId: string,
  payload: { progressName: string; percent: number; note?: string },
) {
  const { data } = await http.patch<ApiResponse<Project>>(
    `/projects/${projectId}/progress/${progressUpdateId}`,
    payload,
  );
  return data;
}

export async function getTasks(projectId?: string) {
  const { data } = await http.get<ApiResponse<Task[]>>("/tasks", {
    params: projectId ? { projectId } : {},
  });
  return data.data;
}

export async function createTask(payload: {
  projectId: string;
  taskName: string;
  taskDate: string;
  dueDate?: string;
  description: string;
  priority: "high" | "medium" | "low";
}) {
  const { data } = await http.post<ApiResponse<Task>>("/tasks", payload);
  return data;
}

export async function updateTaskStatus(taskId: string, payload: { status: Task["status"] }) {
  const { data } = await http.patch<ApiResponse<Task>>(`/tasks/${taskId}/status`, payload);
  return data;
}

export async function createProjectUpdate(payload: FormData) {
  const { data } = await http.post<ApiResponse<UpdateItem>>("/updates", payload);
  return data;
}

export async function getProjectUpdates(projectId: string) {
  const { data } = await http.get<ApiResponse<UpdateItem[]>>(`/updates/project/${projectId}`);
  return data.data;
}

export async function toggleUpdateLike(updateId: string) {
  const { data } = await http.patch<ApiResponse<UpdateItem>>(`/updates/${updateId}/like`);
  return data;
}

export async function deleteProjectUpdate(updateId: string) {
  const { data } = await http.delete<ApiResponse<null>>(`/updates/${updateId}`);
  return data;
}

export async function getUpdateComments(updateId: string) {
  const { data } = await http.get<ApiResponse<CommentItem[]>>(`/updates/${updateId}/comments`);
  return data.data;
}

export async function addUpdateComment(updateId: string, payload: { comment: string }) {
  const { data } = await http.post<ApiResponse<CommentItem>>(`/updates/${updateId}/comments`, payload);
  return data;
}

export async function getDocuments(projectId: string) {
  const { data } = await http.get<ApiResponse<DocumentItem[] | GroupedDocumentsPayload>>(
    `/documents/project/${projectId}`,
  );

  const rawDocuments = data.data;
  if (Array.isArray(rawDocuments)) {
    return rawDocuments;
  }

  if (!rawDocuments || typeof rawDocuments !== "object") {
    return [];
  }

  const grouped = rawDocuments.documents;
  if (!grouped || typeof grouped !== "object") {
    return [];
  }

  const orderedCategories: DocumentCategory[] = [
    "drawings",
    "invoices",
    "reports",
    "contracts",
  ];

  return orderedCategories.flatMap((category) =>
    Array.isArray(grouped[category]) ? grouped[category] : [],
  );
}

export async function uploadDocument(payload: FormData) {
  const { data } = await http.post<ApiResponse<DocumentItem>>("/documents", payload);
  return data;
}

export async function getProjectChat(projectId: string) {
  const { data } = await http.get<ApiResponse<Chat>>(`/chats/project/${projectId}`);
  return data.data;
}

export async function getChatMessages(chatId: string) {
  const { data } = await http.get<ApiResponse<Message[]>>(`/chats/${chatId}/messages`);
  return data.data;
}

export async function sendChatMessage(chatId: string, payload: { message: string }) {
  const { data } = await http.post<ApiResponse<Message>>(`/chats/${chatId}/messages`, payload);
  return data;
}

export default http;

