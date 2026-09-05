export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}
