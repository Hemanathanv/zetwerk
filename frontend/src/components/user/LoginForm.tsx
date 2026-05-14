import React, { useState } from "react";
import AuthButton from "./AuthButton";
import { useAuth } from "@/auth/AuthContext";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ValidationDetail = {
  loc?: Array<string | number>;
  msg?: string;
};

function getLoginErrorMessage(error: any): string {
  const detail = error?.response?.data?.detail;

  if (Array.isArray(detail)) {
    const emailIssue = detail.find(
      (item: ValidationDetail) =>
        Array.isArray(item?.loc) && item.loc.includes("email")
    );

    if (emailIssue?.msg) {
      return emailIssue.msg === "value is not a valid email address"
        ? "Email is invalid."
        : emailIssue.msg;
    }

    const firstIssue = detail[0];
    if (firstIssue?.msg) {
      return firstIssue.msg;
    }

    return "Please check the form and try again.";
  }

  if (typeof detail === "string") {
    if (detail.includes("Invalid email or password")) {
      return "Invalid email or password. Please try again.";
    }
    if (detail.includes("Account is inactive")) {
      return "Your account is inactive. Please contact support.";
    }
    if (detail.includes("Could not create session")) {
      return "Could not create session. Please try again later.";
    }
    return detail;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Login failed. Please try again.";
}

const LoginForm: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const { login } = useAuth();

  // controlled inputs
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    // basic local validation (UX)
    if (!email.trim() || !password) {
      setError("Please enter email and password.");
      setLoading(false);
      return;
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Email is invalid.");
      setLoading(false);
      return;
    }

    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(getLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // disable when loading or required fields empty
  const isSubmitDisabled = loading || !email.trim() || !password;

  return (
    <div>
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4" noValidate>
        <div>
          <label className="block text-sm font-medium text-gray-600">Email</label>
          <input
            type="email"
            placeholder="Email"
            id="Email"
            name="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            className="mt-1 w-full px-4 p-2 h-10 rounded-md border border-gray-200 bg-white text-sm text-gray-700"
            autoComplete="email"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-600">Password</label>
          <input
            type="password"
            placeholder="Password"
            name="password"
            id="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            className="mt-1 w-full px-4 p-2 h-10 rounded-md border border-gray-200 bg-white text-sm text-gray-700"
            autoComplete="current-password"
          />
        </div>

        <div className="mt-4">
          <AuthButton type="login" loading={loading} disabled={isSubmitDisabled} />
        </div>

        {error && <p className="text-red-500">{error}</p>}
      </form>
    </div>
  );
};

export default LoginForm;
