// Name: V.Hemanathan
// Describe: Forgot Password component - sends reset password email
// Framework: React + Vite

import React, { useState } from "react";
import AuthButton from "./AuthButton";
import { Link } from "wouter";
import api from "@/auth/api";

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [resetUrl, setResetUrl] = useState<string | null>(null);

  const basicEmailValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setIsSuccess(false);
    setResetUrl(null);

    const normalized = email.trim().toLowerCase();
    if (!normalized || !basicEmailValid(normalized)) {
      setMessage("Please enter a valid email address.");
      setLoading(false);
      return;
    }

    try {
      // API request to send reset email
      const response = await api.post('/auth/forgot-password', { email: normalized });

      setMessage("If an account exists with this email, you will receive a password reset link shortly.");
      setIsSuccess(true);
      const token = response.data?.reset_token as string | undefined;
      if (token) {
        setResetUrl(`/reset-password?token=${encodeURIComponent(token)}`);
      }
      setEmail("");
    } catch (error) {
      console.error("Forgot password error:", error);
      setMessage("An unexpected error occurred. Please try again.");
      setIsSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  const isSubmitDisabled = loading || !email.trim() || !basicEmailValid(email);

  return (
    <div>
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-200">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="Enter your email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full px-4 p-2 h-10 rounded-md border border-gray-200 bg-white text-sm text-gray-700"
            autoComplete="email"
            disabled={loading}
          />
        </div>

        <div className="mt-4">
          <AuthButton type="Send Reset Link" loading={loading} disabled={isSubmitDisabled} />
        </div>

        {message && (
          <p className={isSuccess ? "mt-2 text-green-500" : "mt-2 text-red-500"}>
            {message}
          </p>
        )}

        {resetUrl && (
          <Link href={resetUrl} className="text-sm text-blue-500 hover:underline">
            Open password reset page
          </Link>
        )}

        <div className="text-center mt-2">
          <Link href="/login" className="text-sm text-blue-400 hover:underline">
            Back to Login
          </Link>
        </div>
      </form>
    </div>
  );
};

export default ForgotPassword;

