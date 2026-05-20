import axios from 'axios';
import type {
  AdminStorageListing,
  AuthStatusResponse,
  DocumentDetailRecord,
  DocumentRecord,
  UserProfile,
} from '@/types/backend';

const SESSION_TOKEN_KEY = 'session_token_fallback';

// Create axios instance with default configuration
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  withCredentials: true, // Required for HTTP-only cookies
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Request interceptor for adding CSRF token if needed
api.interceptors.request.use(
  (config) => {
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
  (error) => {
    if (error.response) {
      // Handle 401 Unauthorized
      if (error.response.status === 401) {
        const requestUrl = String(error.config?.url || '');
        const pathname = window.location.pathname;
        const isAuthStatusRequest = requestUrl.includes('/auth/status');
        const isPublicAuthPage =
          pathname === '/login' ||
          pathname === '/forgot-password' ||
          pathname === '/reset-password';

        if (!isAuthStatusRequest && !isPublicAuthPage) {
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
    return api.post('/auth/logout');
  },

  /**
   * Check authentication status
   * @returns Promise with current user data
   */
  checkAuth: () => {
    return api.get<AuthStatusResponse>('/auth/status');
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
  list: () => api.get<DocumentRecord[]>('/uploads/documents'),
  getById: (documentId: string) => api.get<DocumentDetailRecord>(`/uploads/documents/${documentId}`),
  retry: (documentId: string) => api.post(`/uploads/documents/${documentId}/retry`),
  upload: (formData: FormData) =>
    api.post('/uploads/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 120000,
    }),
};

const adminApi = {
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
export default api;
