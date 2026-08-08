import axios from 'axios';
import { API_BASE_URL, BACKEND_API_BASE } from '@/lib/apiBase';
import type {
  AdminStorageListing,
  ApproveDocumentResponse,
  AuthStatusResponse,
  AuthUser,
  DocumentClassificationBulkResponse,
  DocumentClassificationQueuedResponse,
  DocumentDetailRecord,
  DocumentRecord,
  DocumentClassificationResponse,
  DocumentClassificationStatusResponse,
  ContainerMappingResponse,
  DocumentListResponse,
  DocumentPreviewUrlResponse,
  UserProfile,
  WarehouseMappingResponse,
} from '@/types/backend';

const SESSION_TOKEN_KEY = 'session_token_fallback';
const REFRESH_TOKEN_KEY = 'refresh_token_fallback';
const CLASSIFICATION_POLL_TIMEOUT_MS = 600000;
const CLASSIFICATION_POLL_INTERVAL_MS = 1000;

type TokenRefreshResponse = {
  status: string;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

let refreshPromise: Promise<string | null> | null = null;

// Create axios instance with default configuration
const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Required for HTTP-only cookies
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Request interceptor for adding CSRF token if needed
api.interceptors.request.use(
  (config) => {
    // Fallback: if a legacy localStorage token exists, still send it as Bearer
    // so existing sessions keep working during the transition.
    const fallbackToken = window.localStorage.getItem(SESSION_TOKEN_KEY);
    if (fallbackToken && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${fallbackToken}`;
    }

    // Add CSRF token for state-changing requests (POST, PUT, PATCH, DELETE)
    if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase() || '')) {
      const csrfToken = getCSRFToken();
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for handling errors and 401 responses
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response) {
      // Handle 401 Unauthorized
      if (error.response.status === 401) {
        const originalRequest = error.config || {};
        const requestUrl = String(error.config?.url || '');
        const pathname = window.location.pathname;
        const isAuthStatusRequest =
          requestUrl.includes('/auth/status') ||
          requestUrl.includes('/auth/userinfo') ||
          requestUrl.includes('/auth/roles') ||
          requestUrl.includes('/auth/permissions') ||
          requestUrl.includes('/auth/level');
        const isTokenEndpoint =
          requestUrl.includes('/auth/login') ||
          requestUrl.includes('/auth/refresh');
        const isPublicAuthPage =
          pathname === '/login' ||
          pathname === '/forgot-password' ||
          pathname === '/reset-password';

        if (!isTokenEndpoint && !originalRequest._retry) {
          originalRequest._retry = true;
          const nextAccessToken = await refreshAccessToken();
          if (nextAccessToken) {
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${nextAccessToken}`;
            return api(originalRequest);
          }
        }

        if (!isAuthStatusRequest && !isPublicAuthPage) {
          window.localStorage.removeItem(SESSION_TOKEN_KEY);
          window.localStorage.removeItem(REFRESH_TOKEN_KEY);
          window.location.replace('/login');
        }
      }

      // Handle other error statuses
      if (error.response.status >= 500) {
        console.error('Server error:', error.response.status);
      }
    } else if (error.request) {
      // Request was made but no response received
      console.error('No response received:', error.request);
    } else {
      // Something happened in setting up the request
      console.error('Request setup error:', error.message);
    }

    return Promise.reject(error);
  }
);

// Helper function to get CSRF token from cookie (if needed)
function getCSRFToken(): string | null {
  const name = 'csrftoken=';
  const decodedCookie = decodeURIComponent(document.cookie);
  const cookies = decodedCookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i].trim();
    if (cookie.startsWith(name)) {
      return cookie.substring(name.length);
    }
  }
  return null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusToClassification(status: DocumentClassificationStatusResponse): DocumentClassificationResponse | null {
  if (status.status !== 'success' || !status.docType || !status.label || status.confidence === null) {
    return null;
  }
  return {
    status: 'success',
    message: status.message,
    docType: status.docType,
    label: status.label,
    confidence: status.confidence,
    reasoning: status.reasoning ?? '',
    matchedFields: status.matchedFields,
    alternatives: status.alternatives,
    fileName: status.fileName,
  };
}

async function refreshAccessToken(): Promise<string | null> {
  // Prefer the httpOnly refresh cookie; fall back to legacy localStorage token.
  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);

  if (!refreshPromise) {
    refreshPromise = axios
      .post<TokenRefreshResponse>(
        `${api.defaults.baseURL || ''}/auth/refresh`,
        refreshToken ? { refresh_token: refreshToken } : {},
        {
          withCredentials: true,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        },
      )
      .then((response) => {
        const accessToken = response.data?.access_token;
        if (!accessToken) return null;
        // Keep legacy localStorage in sync for backward compatibility.
        window.localStorage.setItem(SESSION_TOKEN_KEY, accessToken);
        if (response.data.refresh_token) {
          window.localStorage.setItem(REFRESH_TOKEN_KEY, response.data.refresh_token);
        }
        return accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

type KeycloakUserInfo = {
  sub?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
};

type KeycloakPermissions = {
  modules: string[];
  gates: unknown[];
  docTypes: Record<string, string[]>;
  documentScope?: string[];
  activityDocTypes?: Record<string, string[]>;
  ticketCategories: string[];
  activities: string[];
  dataScope: string;
  role: {
    id: string;
    name: string;
    category: string;
    color: string;
    systemCode?: string;
  };
};

type LevelAuthorization = {
  level?: string;
  activities: string[];
};

type KeycloakTokenPayload = {
  sub?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
};

function decodeJwtPayload(token: string): KeycloakTokenPayload {
  const payload = token.split('.')[1];
  if (!payload) return {};
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = decodeURIComponent(
      Array.from(atob(padded))
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    return JSON.parse(json) as KeycloakTokenPayload;
  } catch {
    return {};
  }
}

function rolesFromAccessToken(token: string): string[] {
  const payload = decodeJwtPayload(token);
  const roles = [...(payload.realm_access?.roles ?? [])];
  Object.values(payload.resource_access ?? {}).forEach((clientAccess) => {
    roles.push(...(clientAccess.roles ?? []));
  });
  return [...new Set(roles.map(String))];
}

function userInfoFromAccessToken(token: string): KeycloakUserInfo {
  const payload = decodeJwtPayload(token);
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    preferred_username: payload.preferred_username,
    given_name: payload.given_name,
    family_name: payload.family_name,
  };
}

function roleFromKeycloakRoles(roles: string[]): AuthUser['systemRole'] {
  const normalized = new Set(roles.map((role) => role.toUpperCase().replace(/-/g, '_')));
  if (normalized.has('SUPER_ADMIN')) return 'SUPER_ADMIN';
  if (normalized.has('ADMIN')) return 'ADMIN';
  return 'USER';
}

const ADMIN_FALLBACK_MODULES = [
  'dashboard',
  'shipments',
  'tasks',
  'documents',
  'inventory',
  'warehouse',
  'dnd',
  'accounting',
  'reports',
  'admin',
  'settings',
];

const ADMIN_FALLBACK_ACTIVITIES = [
  'admin.configure_doctypes',
  'admin.configure_roles',
  'admin.edit_account_mappings',
  'admin.edit_workflows',
  'admin.manage',
  'admin.manage_partners',
  'admin.manage_users',
  'admin.security_settings',
  'admin.view_audit_log',
  'documents.approve_container_mapping',
  'documents.approve_draft',
  'documents.approve_generated_document',
  'documents.classify_document_type',
  'documents.delete',
  'documents.discard_draft',
  'documents.download_export',
  'documents.dnd_inputs',
  'documents.dnd_inputs.exclude_holidays',
  'documents.dnd_inputs.exclude_weekends',
  'documents.dnd_inputs.start_event',
  'documents.edit_extracted',
  'documents.fill_manual_fields',
  'documents.generate_draft',
  'documents.manage',
  'documents.map_container_to_sku',
  'documents.modify_generated_fields',
  'documents.ocr_completed',
  'documents.override_approved_fields',
  'documents.override_validation',
  'documents.re_trigger_generation',
  'documents.re_upload_document',
  'documents.reassign_document_to_shipment',
  'documents.reject_container_mapping',
  'documents.reject_extraction',
  'documents.reject_generated_document',
  'documents.reprocess_ocr',
  'documents.resolve_validation_failure',
  'documents.revoke_approval',
  'documents.save_draft',
  'documents.submit_for_approval',
  'documents.submit_for_review',
  'documents.submit_mapping_for_approval',
  'documents.trigger_re_validation',
  'documents.upload',
  'documents.validation_triggered',
  'documents.view',
  'documents.view_draft',
  'documents.view_extracted',
  'documents.view_validation_results',
  'dnd.holiday_calendar.upload',
  'dnd.tariff.create',
  'dnd.tariff.edit',
  'dnd.tariff.force_expire',
  'dnd.tariff.view',
  'inventory.3_way_recon',
  'inventory.acknowledge_dnd',
  'inventory.adjust_stock_with_remarks',
  'inventory.adjust_stock_without_remarks',
  'inventory.approve_dispatch',
  'inventory.create_outward_grn_new_dispatch',
  'inventory.delivered',
  'inventory.inventory_tracking_breakbulk',
  'inventory.modify_lfd',
  'inventory.move_inventory',
  'inventory.reject_dispatch',
  'inventory.returned',
  'inventory.update_milestone',
  'inventory.upload_pod',
  'inventory.view_container',
  'inventory.view_dnd_charges',
  'inventory.view_last_free_days_shipment_based',
  'inventory.view_lfd_calendar',
  'inventory.view_outward_dispatches',
  'inventory.view_timeline',
  'inventory.view_warehouse',
  'inventory.warehouse_inventory_stock_position',
  'roles.manage',
  'roles.view',
  'shipments.archive',
  'shipments.assign_user',
  'shipments.cancel_shipment',
  'shipments.change_shipment_type',
  'shipments.create',
  'shipments.delete',
  'shipments.edit_metadata',
  'shipments.export_details',
  'shipments.hold_shipment',
  'shipments.manage',
  'shipments.override_blocked_stage',
  'shipments.resume_shipment',
  'shipments.tag_partner',
  'shipments.view',
  'tasks.assign',
  'tasks.delegate',
  'tasks.escalate',
  'tasks.update',
  'tasks.view',
  'users.manage',
];

function capabilitiesFromActivities(activities: string[]): Record<string, boolean> {
  const allowed = new Set(activities);
  return {
    isApprove: allowed.has('documents.approve_draft'),
    isEdit: allowed.has('documents.edit_extracted'),
    isUpload: allowed.has('documents.upload'),
    isOverride: allowed.has('documents.override_validation'),
    isReprocess: allowed.has('documents.reprocess_ocr'),
  };
}

function mergeActivities(...activityLists: Array<string[] | null | undefined>): string[] {
  return [...new Set(activityLists.flatMap((activities) => activities ?? []))];
}

function isAdminIdentity(userInfo: KeycloakUserInfo, roles: string[]): boolean {
  const email = (userInfo.email ?? userInfo.preferred_username ?? '').toLowerCase();
  const normalizedRoles = new Set(roles.map((role) => role.toUpperCase().replace(/-/g, '_').replace(/ /g, '_')));
  return (
    email === 'admin@sprconsultech.com' ||
    normalizedRoles.has('ADMIN') ||
    normalizedRoles.has('ORG_ADMIN') ||
    normalizedRoles.has('SPR_ADMIN') ||
    normalizedRoles.has('SUPER_ADMIN') ||
    normalizedRoles.has('SUPER_ADMINISTRATOR')
  );
}

function fallbackPermissions(userInfo: KeycloakUserInfo, roles: string[]): KeycloakPermissions {
  const isAdmin = isAdminIdentity(userInfo, roles);
  const roleId = isAdmin ? 'ADMIN' : 'USER';
  return {
    modules: isAdmin ? ADMIN_FALLBACK_MODULES : [],
    gates: [],
    docTypes: isAdmin
      ? {
          upload: ['*'],
          edit_extracted: ['*'],
          submit_for_approval: ['*'],
          approve_draft: ['*'],
          reject_extraction: ['*'],
          override_approved_fields: ['*'],
          approve_extraction: ['*'],
          review_generation: ['*'],
          container_mapping: ['*'],
          re_upload_document: ['*'],
          reprocess_ocr: ['*'],
          view: ['*'],
        }
      : {},
    documentScope: isAdmin ? [] : undefined,
    activityDocTypes: {},
    ticketCategories: [],
    activities: isAdmin ? ADMIN_FALLBACK_ACTIVITIES : [],
    dataScope: isAdmin ? 'ALL' : 'TAGGED',
    role: {
      id: roleId,
      name: isAdmin ? 'Admin' : 'User',
      category: 'org_internal',
      color: '#0f766e',
      systemCode: roleId.toLowerCase(),
    },
  };
}

function normalizeKeycloakUser(
  userInfo: KeycloakUserInfo,
  roles: string[],
  permissions?: KeycloakPermissions,
  levelAuth?: LevelAuthorization,
): AuthUser {
  const email = (userInfo.email ?? userInfo.preferred_username ?? '').toLowerCase();
  const name =
    userInfo.name ||
    [userInfo.given_name, userInfo.family_name].filter(Boolean).join(' ') ||
    userInfo.preferred_username ||
    email;
  const systemRole = email === 'admin@sprconsultech.com' ? 'ADMIN' : roleFromKeycloakRoles(roles);
  const activities = permissions
    ? mergeActivities(permissions.activities, levelAuth?.activities)
    : [];
  return {
    id: userInfo.sub ?? email,
    name,
    email,
    systemRole,
    isActive: true,
    ...(permissions ? {
      rbacPermissions: {
        ...permissions,
        activities,
        capabilities: capabilitiesFromActivities(activities),
      },
      modules: permissions.modules,
      role: permissions.role,
    } : {}),
  };
}

// Auth-specific helper methods
const authApi = {
  /**
   * Login with email and password
   * @param email User email
   * @param password User password
   * @returns Promise with user data
   */
  login: (email: string, password: string) => {
    return api.post('/auth/login', { email, password });
  },

  /**
   * Logout current user
   * @returns Promise with logout response
   */
  logout: () => {
    // Clear legacy localStorage tokens and call backend to clear httpOnly cookies.
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    return api.post('/auth/logout').catch(() => ({ data: { status: 'success' } }));
  },

  /**
   * Check authentication status
   * @returns Promise with current user data
   */
  checkAuth: () => {
    // First check if we have a legacy localStorage token (backward compat).
    const token = window.localStorage.getItem(SESSION_TOKEN_KEY);
    if (!token) {
      // No legacy token — check if the httpOnly cookie is present via /auth/status.
      return api
        .get<{ authenticated: boolean }>('/auth/status')
        .then((statusResponse) => {
          if (!statusResponse.data?.authenticated) {
            return Promise.reject(new Error('Not authenticated'));
          }
          // Cookie is valid; fetch permissions/level using the cookie.
          return Promise.allSettled([
            api.get<{ user: KeycloakUserInfo }>('/auth/userinfo'),
            api.get<{ roles: string[] }>('/auth/roles'),
            api.get<{ ok: boolean; data: KeycloakPermissions }>('/auth/permissions'),
            api.get<{ ok: boolean; data: LevelAuthorization }>('/auth/level'),
          ]).then(([userinfoResult, rolesResult, permissionsResult, levelResult]) => {
            const userInfo = userinfoResult.status === 'fulfilled'
              ? userinfoResult.value.data.user
              : {};
            const roles = rolesResult.status === 'fulfilled'
              ? rolesResult.value.data.roles
              : [];
            const permissions = permissionsResult.status === 'fulfilled'
              ? permissionsResult.value.data.data
              : fallbackPermissions(userInfo, roles);
            const levelAuth = levelResult.status === 'fulfilled'
              ? levelResult.value.data.data
              : { level: isAdminIdentity(userInfo, roles) ? 'L4' : 'L1', activities: permissions.activities };

            return {
              data: {
                status: 'success',
                user: normalizeKeycloakUser(
                  userInfo,
                  roles,
                  permissions,
                  levelAuth,
                ),
              } satisfies AuthStatusResponse,
            };
          });
        });
    }

    const roles = rolesFromAccessToken(token);
    return Promise.allSettled([
      api.get<{ ok: boolean; data: KeycloakPermissions }>('/auth/permissions'),
      api.get<{ ok: boolean; data: LevelAuthorization }>('/auth/level'),
    ]).then(([permissionsResult, levelResult]) => {
      const userInfo = userInfoFromAccessToken(token);
      const permissions = permissionsResult.status === 'fulfilled'
        ? permissionsResult.value.data.data
        : fallbackPermissions(userInfo, roles);
      const levelAuth = levelResult.status === 'fulfilled'
        ? levelResult.value.data.data
        : { level: isAdminIdentity(userInfo, roles) ? 'L4' : 'L1', activities: permissions.activities };

      if (permissionsResult.status === 'rejected' || levelResult.status === 'rejected') {
        console.error('RBAC bootstrap failed; using token role fallback permissions.', {
          permissionsError: permissionsResult.status === 'rejected' ? permissionsResult.reason : null,
          levelError: levelResult.status === 'rejected' ? levelResult.reason : null,
        });
      }

      return {
        data: {
          status: 'success',
          user: normalizeKeycloakUser(
            userInfo,
            roles,
            permissions,
            levelAuth,
          ),
        } satisfies AuthStatusResponse,
      };
    });
  },

  /**
   * Change password
   * @param oldPassword Current password
   * @param newPassword New password
   * @returns Promise with change password response
   */
  changePassword: (oldPassword: string, newPassword: string) => {
    return api.post('/auth/change-password', { old_password: oldPassword, new_password: newPassword });
  },

  /**
   * Get current user profile with usage statistics
   * @returns Promise with user profile data
   */
  getProfile: () => {
    return api.get<UserProfile>('/settings/profile');
  },

  /**
   * Update user profile
   * @param profileData Profile data to update (name, email)
   * @returns Promise with updated profile
   */
  updateProfile: (profileData: {
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    department?: string | null;
    designation?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    location?: string | null;
    timezone?: string | null;
  }) => {
    return api.put('/settings/profile', profileData);
  }
};

const documentApi = {
  list: (params?: { page?: number; pageSize?: number; section?: string }) =>
    api.get<DocumentListResponse>('/uploads/documents', { params }),
  getQueueItem: (documentId: string) => api.get<DocumentRecord>(`/uploads/documents/${documentId}/queue-item`),
  getById: (documentId: string) => api.get<DocumentDetailRecord>(`/uploads/documents/${documentId}`),
  getPreviewUrl: (documentId: string) => api.get<DocumentPreviewUrlResponse>(`/uploads/documents/${documentId}/preview-url`),
  getContainerMapping: (documentId: string, page = 1, pageSize = 20, unmappedOnly = false) =>
    api.get<ContainerMappingResponse>(`/uploads/documents/${documentId}/container-mapping`, {
      params: { page, pageSize, unmappedOnly },
    }),
  saveContainerMapping: (
    documentId: string,
    assignments: Array<{ lineItemId: string; containerNo: string | null }>,
  ) => api.patch(`/uploads/documents/${documentId}/container-mapping`, { assignments }),
  getWarehouseMapping: (documentId: string) =>
    api.get<{ ok: boolean; data: WarehouseMappingResponse }>(`/uploads/documents/${documentId}/warehouse-mapping`),
  saveWarehouseMapping: (documentId: string, warehouseId: string | null) =>
    api.patch<{ ok: boolean; data: WarehouseMappingResponse }>(`/uploads/documents/${documentId}/warehouse-mapping`, { warehouseId }),
  retry: (documentId: string) => api.post(`/uploads/documents/${documentId}/retry`),
  reupload: (documentId: string, formData: FormData) =>
    api.post(`/uploads/documents/${documentId}/reupload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  stop: (documentId: string) => api.post(`/uploads/documents/${documentId}/stop`),
  updateExtraction: (
    documentId: string,
    payload: {
      fields?: Record<string, unknown>;
      arrays?: Record<string, Array<Record<string, unknown>>>;
    },
  ) => api.patch(`/uploads/documents/${documentId}/extraction`, payload),
  approve: (documentId: string) => api.post<ApproveDocumentResponse>(`/uploads/documents/${documentId}/approve`),
  classify: async (formData: FormData) => {
    const config = {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: CLASSIFICATION_POLL_TIMEOUT_MS,
    };
    let queued;
    try {
      queued = await api.post<DocumentClassificationQueuedResponse>('/uploads/classify', formData, config);
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 404 || !BACKEND_API_BASE) {
        throw error;
      }
      queued = await api.post<DocumentClassificationQueuedResponse>(`${BACKEND_API_BASE}/api/v1/uploads/classify`, formData, config);
    }
    const startedAt = Date.now();
    const jobId = queued.data.classificationJobId;
    while (Date.now() - startedAt < CLASSIFICATION_POLL_TIMEOUT_MS) {
      await wait(CLASSIFICATION_POLL_INTERVAL_MS);
      let statusResponse;
      try {
        statusResponse = await api.get<DocumentClassificationStatusResponse>(`/uploads/classify/jobs/${jobId}`);
      } catch (error) {
        if (!axios.isAxiosError(error) || error.response?.status !== 404 || !BACKEND_API_BASE) {
          throw error;
        }
        statusResponse = await api.get<DocumentClassificationStatusResponse>(`${BACKEND_API_BASE}/api/v1/uploads/classify/jobs/${jobId}`);
      }
      const status = statusResponse.data;
      if (status.status === 'failed') {
        throw new Error(status.message || 'Document classification failed.');
      }
      const classification = statusToClassification(status);
      if (classification) {
        return {
          ...statusResponse,
          data: classification,
        };
      }
    }
    throw new Error('Document classification timed out.');
  },
  classifyBulk: async (formData: FormData) => {
    const config = {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: CLASSIFICATION_POLL_TIMEOUT_MS,
    };
    try {
      return await api.post<DocumentClassificationBulkResponse>('/uploads/classify/bulk', formData, config);
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 404 || !BACKEND_API_BASE) {
        throw error;
      }
      return api.post<DocumentClassificationBulkResponse>(`${BACKEND_API_BASE}/api/v1/uploads/classify/bulk`, formData, config);
    }
  },
  classifyBulkAndWait: async (formData: FormData) => {
    const queued = await documentApi.classifyBulk(formData);
    const startedAt = Date.now();
    const pending = new Map(queued.data.jobs.map((job) => [job.classificationJobId, job]));
    const completed = new Map<string, { result: DocumentClassificationResponse | null; error?: string }>();

    while (pending.size > 0 && Date.now() - startedAt < CLASSIFICATION_POLL_TIMEOUT_MS) {
      await wait(CLASSIFICATION_POLL_INTERVAL_MS);
      await Promise.all(
        Array.from(pending.keys()).map(async (jobId) => {
          const statusResponse = await documentApi.getClassificationJob(jobId);
          const status = statusResponse.data;
          if (status.status === 'failed') {
            completed.set(jobId, { result: null, error: status.message || 'Document classification failed.' });
            pending.delete(jobId);
            return;
          }
          const classification = statusToClassification(status);
          if (classification) {
            completed.set(jobId, { result: classification });
            pending.delete(jobId);
          }
        }),
      );
    }

    for (const jobId of pending.keys()) {
      completed.set(jobId, { result: null, error: 'Document classification timed out.' });
    }

    return queued.data.jobs.map((job) => ({
      fileName: job.fileName,
      ...(completed.get(job.classificationJobId) ?? { result: null, error: 'Document classification timed out.' }),
    }));
  },
  getClassificationJob: async (classificationJobId: string) => {
    try {
      return await api.get<DocumentClassificationStatusResponse>(`/uploads/classify/jobs/${classificationJobId}`);
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 404 || !BACKEND_API_BASE) {
        throw error;
      }
      return api.get<DocumentClassificationStatusResponse>(`${BACKEND_API_BASE}/api/v1/uploads/classify/jobs/${classificationJobId}`);
    }
  },
  upload: (formData: FormData) =>
    api.post('/uploads/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 120000,
    }),
};

const adminApi = {
  listUsers: () => api.get<{ ok: boolean; data: Array<{
    id: string;
    email: string;
    fullName: string;
    status: string;
    lastLoginAt: string | null;
    role: { id: string; name: string; roleCategory: string } | null;
  }> }>('/admin/users'),
  listRoles: () => api.get<{ ok: boolean; data: Array<{
    id: string;
    name: string;
    roleCategory: string;
  }> }>('/admin/roles'),
  inviteUser: (payload: {
    email: string;
    fullName: string;
    roleId: string;
    password?: string;
  }) => api.post<{ ok: boolean; error?: string }>('/admin/users/invite', payload),
  listBuckets: () => api.get<{ buckets: string[] }>('/admin/storage/buckets'),
  listStorage: (bucket: string, prefix = '') =>
    api.get<AdminStorageListing>('/admin/storage', {
      params: { bucket, prefix },
    }),
  deleteStorageFile: (bucket: string, key: string) =>
    api.delete('/admin/storage/file', {
      data: { bucket, key },
    }),
  deleteDocument: (documentId: string) =>
    api.delete(`/admin/documents/${documentId}`),
};

// Export both the raw api and the auth helpers
export { authApi };
export { adminApi };
export { documentApi };
export { SESSION_TOKEN_KEY };
export { REFRESH_TOKEN_KEY };
export default api;
