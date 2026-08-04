import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Settings2 } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { authApi } from "@/auth/api";
import type { UserProfile } from "@/types/backend";

export default function SettingsView() {
  const { toast } = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileForm, setProfileForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    department: "",
    designation: "",
    location: "",
    timezone: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    const loadProfile = async () => {
      setLoadingProfile(true);
      try {
        const response = await authApi.getProfile();
        const nextProfile = response.data;
        setProfile(nextProfile);
        setProfileForm({
          firstName: nextProfile.firstName ?? "",
          lastName: nextProfile.lastName ?? "",
          phone: nextProfile.phone ?? "",
          department: nextProfile.department ?? "",
          designation: nextProfile.designation ?? "",
          location: nextProfile.location ?? "",
          timezone: nextProfile.timezone ?? "",
        });
      } catch (error) {
        toast({
          title: "Could not load profile",
          description: "Please refresh and try again.",
          variant: "destructive",
        });
      } finally {
        setLoadingProfile(false);
      }
    };

    loadProfile();
  }, [toast]);

  const hasProfileChanges = useMemo(() => {
    if (!profile) return false;
    return (
      (profile.firstName ?? "") !== profileForm.firstName ||
      (profile.lastName ?? "") !== profileForm.lastName ||
      (profile.phone ?? "") !== profileForm.phone ||
      (profile.department ?? "") !== profileForm.department ||
      (profile.designation ?? "") !== profileForm.designation ||
      (profile.location ?? "") !== profileForm.location ||
      (profile.timezone ?? "") !== profileForm.timezone
    );
  }, [profile, profileForm]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const response = await authApi.updateProfile({
        firstName: profileForm.firstName || null,
        lastName: profileForm.lastName || null,
        phone: profileForm.phone || null,
        department: profileForm.department || null,
        designation: profileForm.designation || null,
        location: profileForm.location || null,
        timezone: profileForm.timezone || null,
      });
      setProfile(response.data);
      toast({ title: "Profile updated", description: "Your settings were saved." });
    } catch (error) {
      toast({
        title: "Update failed",
        description: "We could not save your profile right now.",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      toast({
        title: "Missing password fields",
        description: "Enter your current and new password.",
        variant: "destructive",
      });
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Confirm the new password to continue.",
        variant: "destructive",
      });
      return;
    }

    setSavingPassword(true);
    try {
      await authApi.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast({ title: "Password changed", description: "Your password has been updated." });
    } catch (error) {
      toast({
        title: "Password update failed",
        description: "Please verify your current password and try again.",
        variant: "destructive",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <PageLayout
      title="Profile Settings"
      description="Manage your personal profile and change your account password."
      icon={Settings2}
      accentColor="bg-cyan-500"
    >
      {loadingProfile ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading profile...
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <h3 className="text-base font-semibold">Profile</h3>
              <p className="text-sm text-muted-foreground">These fields map to the auth profile record.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" value={profileForm.firstName} onChange={(value) => setProfileForm((current) => ({ ...current, firstName: value }))} />
              <Field label="Last name" value={profileForm.lastName} onChange={(value) => setProfileForm((current) => ({ ...current, lastName: value }))} />
              <Field label="Phone" value={profileForm.phone} onChange={(value) => setProfileForm((current) => ({ ...current, phone: value }))} />
              <Field label="Department" value={profileForm.department} onChange={(value) => setProfileForm((current) => ({ ...current, department: value }))} />
              <Field label="Designation" value={profileForm.designation} onChange={(value) => setProfileForm((current) => ({ ...current, designation: value }))} />
              <Field label="Location" value={profileForm.location} onChange={(value) => setProfileForm((current) => ({ ...current, location: value }))} />
              <Field label="Timezone" value={profileForm.timezone} onChange={(value) => setProfileForm((current) => ({ ...current, timezone: value }))} />
              <Field label="Email" value={profile?.email ?? ""} onChange={() => undefined} disabled />
            </div>

            <Button onClick={saveProfile} disabled={!hasProfileChanges || savingProfile}>
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Profile
            </Button>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <h3 className="text-base font-semibold">Security</h3>
              <p className="text-sm text-muted-foreground">Use your current password to set a new one.</p>
            </div>

            <Field
              label="Current password"
              type="password"
              value={passwordForm.currentPassword}
              onChange={(value) => setPasswordForm((current) => ({ ...current, currentPassword: value }))}
            />
            <Field
              label="New password"
              type="password"
              value={passwordForm.newPassword}
              onChange={(value) => setPasswordForm((current) => ({ ...current, newPassword: value }))}
            />
            <Field
              label="Confirm password"
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(value) => setPasswordForm((current) => ({ ...current, confirmPassword: value }))}
            />

            <Button onClick={changePassword} disabled={savingPassword}>
              {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Change Password
            </Button>
          </section>
        </div>
      )}
    </PageLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <Input value={value} type={type} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
