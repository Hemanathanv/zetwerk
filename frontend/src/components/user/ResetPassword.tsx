// Name: V.Hemanathan
// Describe: Reset Password component - resets password using token from email link
// Framework: React + Vite

import React, { useState } from "react";
import AuthButton from "./AuthButton";
import { Link } from "wouter";
import api from "@/auth/api";

const ResetPassword = () => {
  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token");

  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setIsSuccess(false);

    if (!token) {
      setMessage("Invalid or missing reset token. Please request a new password reset link.");
      setLoading(false);
      return;
    }

    if (!password || password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      setLoading(false);
      return;
    }

    if (password.length > 20) {
      setMessage("Password must be 20 characters or less.");
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      setLoading(false);
      return;
    }

    try {
      const response = await api.post('/auth/reset-password', {
        newPassword: password,
        token,
      });

      setMessage("Password reset successful! Redirecting to login...");
      setIsSuccess(true);
      setPassword("");
      setConfirmPassword("");

      // Redirect to login after 2 seconds
      setTimeout(() => {
        window.location.href = "/login";
      }, 2000);
    } catch (error) {
      console.error("Reset password error:", error);
      setMessage("An unexpected error occurred. Please try again.");
      setIsSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  const isSubmitDisabled = loading || !password || password.length < 8 || !confirmPassword || password !== confirmPassword;

  // Show error if no token is present
  if (!token) {
    return (
      <div className="text-center">
        <p className="text-red-500 mb-4">
          Invalid or missing reset token. Please request a new password reset link.
        </p>
        <Link href="/forgot-password" className="text-blue-400 hover:underline">
          Request Password Reset
        </Link>
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-200">
            New Password
          </label>
          <input
            type="password"
            placeholder="Password (8-20 characters)"
            id="Password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full px-4 p-2 h-10 rounded-md border border-gray-200 bg-white text-sm text-gray-700"
            autoComplete="new-password"
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-200">
            Confirm Password
          </label>
          <input
            type="password"
            placeholder="Confirm your password"
            id="ConfirmPassword"
            name="confirmPassword"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full px-4 p-2 h-10 rounded-md border border-gray-200 bg-white text-sm text-gray-700"
            autoComplete="new-password"
            disabled={loading}
          />
        </div>

        <div className="mt-4">
          <AuthButton type="Reset Password" loading={loading} disabled={isSubmitDisabled} />
        </div>

        {message && (
          <p className={isSuccess ? "text-green-500" : "text-red-500"}>
            {message}
          </p>
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

export default ResetPassword;
