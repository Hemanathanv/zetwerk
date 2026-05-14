import ForgotPassword from "@/components/user/ForgotPassword";
import { Link } from "wouter";

export default function ForgotPasswordPage() {
  return (
    <div className="w-full flex mt-10 justify-center min-h-screen bg-gray-50">
      <section className="flex flex-col w-[400px] bg-white p-8 rounded-xl shadow-lg">
        {/* Logo and App Name */}
        <div className="hidden lg:flex items-center gap-3 mb-2">
          <img
            src="/sidebar-left-logo.svg"
            alt="Zetwerk OCR Logo"
            className="w-16 h-10 mb-2"
          />
          <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">Zetwerk OCR</h2>
              <p className="text-gray-600 mt-2">Reset your password</p>
          </div>
        </div>

        <ForgotPassword />

        <div className="mt-6 text-center">
          <span className="text-sm text-gray-600">Remember your password? </span>
          <Link className="font-medium text-blue-600 hover:underline text-sm" to="/login">
            Sign In
          </Link>
        </div>
      </section>
    </div>
  );
}
