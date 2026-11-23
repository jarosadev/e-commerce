import axios from 'axios';

const apiClient = axios.create({
  baseURL: 'http://localhost:4000/api/v1',
  withCredentials: true, // For SameSite=Lax cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to inject x-tenant-host if available (from context or headers)
apiClient.interceptors.request.use((config) => {
  // In a browser environment, this might need to come from a store or window object
  // For now, we assume it can be accessed if set
  if (typeof window !== 'undefined') {
    const tenantHost = sessionStorage.getItem('x-tenant-host');
    if (tenantHost) {
      config.headers['x-tenant-host'] = tenantHost;
    }
  }
  return config;
});

// Interceptor for 401 handling (refresh token flow)
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        // Attempt to refresh
        await apiClient.post('/auth/refresh');
        return apiClient(originalRequest);
      } catch {
        // Redirect to login if refresh fails
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
