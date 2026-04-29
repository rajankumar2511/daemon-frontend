import axios from "axios";

// 🚨 Fail fast if env is missing (prevents production bugs)
if (!import.meta.env.VITE_API_URL) {
  throw new Error("❌ VITE_API_URL is not defined");
}

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

export default apiClient;