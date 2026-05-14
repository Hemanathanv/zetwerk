import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { LogOutIcon } from "lucide-react";

export function LogoutButton() {
  const { logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <Button
      onClick={handleLogout}
      variant="outline"
      className="font-mono text-sm"
    >
      <LogOutIcon className="mr-2" />
    </Button>
  );
}