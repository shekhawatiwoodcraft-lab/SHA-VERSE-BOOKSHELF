import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { z } from "zod";
import { Loader2, Mail, Phone, ArrowLeft, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import AppLogoStatusRing from "@/components/promotions/AppLogoStatusRing";
import { shouldUseNativeGoogle, nativeGoogleSignIn, nativeGoogleDiagnostics } from "@/lib/auth/nativeGoogleAuth";
import { useAuth } from "@/contexts/AuthContext";
import {
  classifySignUpOutcome,
  extractOAuthErrorFromLocation,
  formatAuthErrorMessage,
  normalizeAuthEmail,
} from "@/modules/auth/lib/authHelpers";

// Validation schemas
const emailSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const phoneSchema = z.object({
  phone: z.string().min(10, "Enter a valid phone number").max(15, "Phone number too long"),
});

const signupSchema = emailSchema.extend({
  username: z.string().min(3, "Username must be at least 3 characters"),
  displayName: z.string().min(2, "Display name must be at least 2 characters"),
});

type AuthMethod = "email" | "phone" | "otp-verify" | "forgot-password" | "reset-password";

// Toggle "Login with mobile no" (Phone OTP) visibility.
// Set to true to re-enable the Phone tab when requested.
const SHOW_PHONE_LOGIN = false;

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [authErrorBanner, setAuthErrorBanner] = useState<string | null>(null);
  const [authSuccessBanner, setAuthSuccessBanner] = useState<string | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  // Detect password recovery mode via query param or Supabase auth event
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      if (params.get("mode") === "reset" || hashParams.get("type") === "recovery") {
        setAuthMethod("reset-password");
      }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setAuthMethod("reset-password");
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // If the user is already authenticated (and NOT completing password recovery),
  // bounce them home instead of showing the login form.
  useEffect(() => {
    if (user && authMethod !== "reset-password") navigate("/", { replace: true });
  }, [user, navigate, authMethod]);

  // Surface any OAuth redirect errors (e.g. Google Consent Screen testing mode / DB trigger errors)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const oauthErr = extractOAuthErrorFromLocation(window.location.search, window.location.hash);
    if (oauthErr) {
      setAuthErrorBanner(oauthErr);
      toast({ title: "Sign-In Issue", description: oauthErr, variant: "destructive" });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [toast]);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Log login attempt
  const logAttempt = async (identifier: string, attemptType: string, success: boolean) => {
    try {
      await supabase.from("login_attempts").insert({
        identifier,
        attempt_type: attemptType,
        success,
        user_agent: navigator.userAgent,
      });
    } catch (error) {
      // Silent fail for logging
    }
  };

  // Email/Password authentication
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthErrorBanner(null);

    const trimmedEmail = normalizeAuthEmail(email);
    const trimmedUsername = username.trim();
    const trimmedDisplayName = displayName.trim();

    try {
      if (isLogin) {
        emailSchema.parse({ email: trimmedEmail, password });
      } else {
        signupSchema.parse({
          email: trimmedEmail,
          password,
          username: trimmedUsername,
          displayName: trimmedDisplayName,
        });
      }

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
        setPendingVerificationEmail(null);
        void logAttempt(trimmedEmail, "email", true);
        toast({ title: "Welcome back!", description: "Successfully logged in" });
        navigate("/");
      } else {
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: {
              username: trimmedUsername,
              display_name: trimmedDisplayName,
            },
            emailRedirectTo: `${window.location.origin}/`,
          },
        });
        if (error) throw error;

        await logAttempt(trimmedEmail, "email", true);
        const outcome = classifySignUpOutcome(signUpData);

        if (outcome === "signed_in") {
          setPendingVerificationEmail(null);
          toast({ title: "Account created!", description: "Welcome to Sha-Verse!" });
          navigate("/");
        } else if (outcome === "already_registered_unconfirmed") {
          setPendingVerificationEmail(trimmedEmail);
          setIsLogin(true);
          const msg =
            "Yeh email pehle se registered hai. Agar verify nahi hui to neeche 'Resend Verification Email' dabayein, ya Sign In karein.";
          setAuthErrorBanner(msg);
          toast({ title: "Account Already Exists", description: msg });
        } else {
          setPendingVerificationEmail(trimmedEmail);
          setIsLogin(true);
          toast({
            title: "Account created! Verify email",
            description: `${trimmedEmail} par verification link bheja gaya hai. Verify karke Sign In karein.`,
          });
        }
      }
    } catch (error: unknown) {
      await logAttempt(trimmedEmail || email, "email", false);
      if (error instanceof z.ZodError) {
        const msg = error.errors[0].message;
        setAuthErrorBanner(msg);
        toast({ title: "Validation Error", description: msg, variant: "destructive" });
      } else {
        const formatted = formatAuthErrorMessage(error);
        setAuthErrorBanner(formatted.message);
        if (formatted.isEmailNotConfirmed && trimmedEmail) {
          setPendingVerificationEmail(trimmedEmail);
        }
        toast({ title: "Login Error", description: formatted.message, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!pendingVerificationEmail || resendingEmail) return;
    setResendingEmail(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: pendingVerificationEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
      toast({
        title: "Verification Email Sent",
        description: `${pendingVerificationEmail} ka inbox aur Spam folder check karein.`,
      });
    } catch (error: unknown) {
      const formatted = formatAuthErrorMessage(error);
      setAuthErrorBanner(formatted.message);
      toast({ title: "Resend Failed", description: formatted.message, variant: "destructive" });
    } finally {
      setResendingEmail(false);
    }
  };

  // Google OAuth
  const handleGoogleAuth = async () => {
    setLoading(true);
    setAuthErrorBanner(null);
    try {
      // Native app (Android/iOS): use native Google account picker → idToken.
      // This avoids the /~oauth webview redirect that 404s in standalone builds.
      if (shouldUseNativeGoogle()) {
        try {
          await nativeGoogleSignIn();
          toast({ title: "Welcome back!", description: "Successfully logged in with Google" });
          navigate("/");
          return;
        } catch (nativeError: unknown) {
          const errObj = nativeError as { code?: string; message?: string } | undefined;
          const msg = String(errObj?.message ?? nativeError ?? "");
          const pluginMissing =
            errObj?.code === "UNIMPLEMENTED" ||
            /not implemented|unimplemented|not available|not registered/i.test(msg);
          // Plugin missing in this build → fall through to the managed web OAuth
          // flow instead of dead-ending the user.
          if (!pluginMissing) throw nativeError;
          console.warn(
            "[GoogleAuth] Native plugin unavailable, using web OAuth fallback:",
            msg,
            nativeGoogleDiagnostics(),
          );
          toast({
            title: "Using browser sign-in",
            description: `Native picker missing — ${nativeGoogleDiagnostics()}`,
          });
        }
      }

      // Preflight check whether Google provider is enabled on the connected Supabase project
      // so users never get redirected to a raw JSON 400 page when provider is still off.
      if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
        try {
          const settingsRes = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
            headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
          });
          if (settingsRes.ok) {
            const settings = (await settingsRes.json()) as { external?: { google?: boolean } };
            if (settings?.external?.google === false) {
              const msg =
                "Google Sign-In abhi Supabase me save nahi hua hai. Supabase → Authentication → Providers → Google me Client ID aur Client Secret paste karke Save karein.";
              setAuthErrorBanner(msg);
              toast({
                title: "Google Sign-In Not Saved Yet",
                description: msg,
                variant: "destructive",
              });
              setLoading(false);
              return;
            }
          }
        } catch {
          // Ignore network preflight errors and fall through to standard OAuth flow
        }
      }

      // Web: Standard Supabase OAuth against the connected Supabase project.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: {
            prompt: "select_account",
          },
        },
      });

      if (error) throw error;
    } catch (error: unknown) {
      const formatted = formatAuthErrorMessage(error);
      setAuthErrorBanner(formatted.message);
      toast({ title: "Google Sign-In", description: formatted.message, variant: "destructive" });
      setLoading(false);
    }
  };

  // Send OTP to phone
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      phoneSchema.parse({ phone });

      // Format phone number (ensure it has country code)
      const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;

      const { error } = await supabase.auth.signInWithOtp({
        phone: formattedPhone,
      });

      if (error) throw error;

      setAuthMethod("otp-verify");
      setCountdown(60); // 60 seconds cooldown
      toast({ title: "OTP Sent!", description: "Check your phone for the verification code" });
    } catch (error: unknown) {
      await logAttempt(phone, "phone", false);
      if (error instanceof z.ZodError) {
        toast({ title: "Validation Error", description: error.errors[0].message, variant: "destructive" });
      } else {
        const msg = error instanceof Error ? error.message : String(error || "Failed to send OTP");
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  // Verify OTP
  const handleVerifyOtp = async () => {
    if (otp.length !== 6) {
      toast({ title: "Error", description: "Please enter the complete 6-digit code", variant: "destructive" });
      return;
    }

    setLoading(true);

    try {
      const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;

      const { error } = await supabase.auth.verifyOtp({
        phone: formattedPhone,
        token: otp,
        type: "sms",
      });

      if (error) throw error;

      await logAttempt(phone, "phone", true);
      toast({ title: "Success!", description: "Phone number verified successfully" });
      navigate("/");
    } catch (error: unknown) {
      await logAttempt(phone, "phone", false);
      const msg = error instanceof Error ? error.message : String(error || "Invalid OTP");
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (countdown > 0) return;
    await handleSendOtp({ preventDefault: () => {} } as React.FormEvent);
  };

  const resetToMethodSelection = () => {
    setAuthMethod("email");
    setOtp("");
    setAuthErrorBanner(null);
    setAuthSuccessBanner(null);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthErrorBanner(null);
    setAuthSuccessBanner(null);
    const trimmedEmail = normalizeAuthEmail(email);

    try {
      z.string().email("Please enter a valid email address").parse(trimmedEmail);
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/auth?mode=reset`,
      });
      if (error) throw error;
      const msg = `Password reset link sent to ${trimmedEmail}. Inbox aur Spam folder check karein.`;
      setAuthSuccessBanner(msg);
      toast({ title: "Reset Link Sent", description: msg });
    } catch (error: unknown) {
      const msg =
        error instanceof z.ZodError
          ? error.errors[0].message
          : formatAuthErrorMessage(error).message;
      setAuthErrorBanner(msg);
      toast({ title: "Reset Request Failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCompletePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthErrorBanner(null);
    setAuthSuccessBanner(null);

    try {
      if (password.length < 6) {
        throw new Error("New password must be at least 6 characters.");
      }
      if (password !== confirmNewPassword) {
        throw new Error("Passwords do not match.");
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({
        title: "Password Updated",
        description: "Your password has been updated successfully.",
      });
      setPassword("");
      setConfirmNewPassword("");
      setAuthMethod("email");
      navigate("/", { replace: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : formatAuthErrorMessage(error).message;
      setAuthErrorBanner(msg);
      toast({ title: "Password Reset Failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SEO
        title="Sign in to Sha-Verse — Email, phone, or Google"
        description="Sign in or create your Sha-Verse account. Connect with friends, share posts, watch videos, read books, and chat with NovaChat AI."
        path="/auth"
      />
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center p-4 safe-all">
        <Card className="w-full max-w-md p-5 sm:p-8 shadow-glow">
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-2 mb-2">
              <AppLogoStatusRing src="/sha-verse-logo.jpeg" alt="Sha-Verse" size="w-10 h-10" showPlus={false} />
              <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                Sha-Verse
                <span className="sr-only"> — Sign in to your social universe</span>
              </h1>
            </div>
            <p className="text-sm sm:text-base text-muted-foreground">
              {authMethod === "otp-verify"
                ? "Verify your phone"
                : authMethod === "forgot-password"
                  ? "Reset your password"
                  : authMethod === "reset-password"
                    ? "Set a new password"
                    : isLogin
                      ? "Welcome back!"
                      : "Create your account"}
            </p>
          </div>

          {authSuccessBanner && (
            <div
              role="status"
              className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs sm:text-sm text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{authSuccessBanner}</span>
            </div>
          )}

          {pendingVerificationEmail && (
            <div
              role="status"
              className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3.5 text-xs sm:text-sm space-y-2.5"
            >
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    Email verification pending ({pendingVerificationEmail})
                  </p>
                  <p className="text-muted-foreground">
                    Inbox ya Spam folder me verification link par click karein, fir Sign In karein.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResendVerification}
                disabled={resendingEmail}
                className="w-full"
              >
                {resendingEmail ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Resend Verification Email"
                )}
              </Button>
            </div>
          )}

          {authErrorBanner && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs sm:text-sm text-destructive"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{authErrorBanner}</span>
            </div>
          )}

          {/* Forgot Password Screen */}
          {authMethod === "forgot-password" ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <button
                type="button"
                onClick={resetToMethodSelection}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors touch-target"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Sign In
              </button>
              <div className="space-y-2">
                <Label htmlFor="reset-email" className="text-sm">
                  Account Email
                </Label>
                <Input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input-mobile bg-secondary"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-gradient-primary shadow-glow touch-target-lg h-12"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Sending link...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>
            </form>
          ) : authMethod === "reset-password" ? (
            <form onSubmit={handleCompletePasswordReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-sm">
                  New Password
                </Label>
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="input-mobile bg-secondary"
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-new-password" className="text-sm">
                  Confirm New Password
                </Label>
                <Input
                  id="confirm-new-password"
                  type={showPassword ? "text" : "password"}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="input-mobile bg-secondary"
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-gradient-primary shadow-glow touch-target-lg h-12"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Updating password...
                  </>
                ) : (
                  "Update Password"
                )}
              </Button>
            </form>
          ) : authMethod === "otp-verify" ? (
            <div className="space-y-6">
              <button
                onClick={resetToMethodSelection}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors touch-target"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-4">
                  Enter the 6-digit code sent to <span className="font-medium text-foreground">{phone}</span>
                </p>

                <div className="flex justify-center mb-6">
                  <InputOTP maxLength={6} value={otp} onChange={setOtp} className="gap-2">
                    <InputOTPGroup>
                      <InputOTPSlot index={0} className="w-10 h-12 sm:w-12 sm:h-14 text-lg" />
                      <InputOTPSlot index={1} className="w-10 h-12 sm:w-12 sm:h-14 text-lg" />
                      <InputOTPSlot index={2} className="w-10 h-12 sm:w-12 sm:h-14 text-lg" />
                      <InputOTPSlot index={3} className="w-10 h-12 sm:w-12 sm:h-14 text-lg" />
                      <InputOTPSlot index={4} className="w-10 h-12 sm:w-12 sm:h-14 text-lg" />
                      <InputOTPSlot index={5} className="w-10 h-12 sm:w-12 sm:h-14 text-lg" />
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                <Button
                  onClick={handleVerifyOtp}
                  className="w-full bg-gradient-primary shadow-glow touch-target-lg h-12"
                  disabled={loading || otp.length !== 6}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Verify OTP"
                  )}
                </Button>

                <div className="mt-4">
                  {countdown > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Resend code in <span className="font-medium text-primary">{countdown}s</span>
                    </p>
                  ) : (
                    <button
                      onClick={handleResendOtp}
                      className="text-sm text-primary hover:underline touch-target py-2"
                      disabled={loading}
                    >
                      Resend OTP
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Auth Method Tabs */}
              <Tabs value={authMethod} onValueChange={(v) => setAuthMethod(v as AuthMethod)} className="mb-6">
                {SHOW_PHONE_LOGIN && (
                  <TabsList className="grid w-full grid-cols-2 h-11">
                    <TabsTrigger value="email" className="flex items-center gap-2 touch-target">
                      <Mail className="w-4 h-4" />
                      <span>Email</span>
                    </TabsTrigger>
                    <TabsTrigger value="phone" className="flex items-center gap-2 touch-target">
                      <Phone className="w-4 h-4" />
                      <span>Phone</span>
                    </TabsTrigger>
                  </TabsList>
                )}

                {/* Email Tab */}
                <TabsContent value="email" className="mt-4">
                  <form onSubmit={handleEmailAuth} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-sm">
                        Email
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="input-mobile bg-secondary"
                        placeholder="you@example.com"
                        autoComplete="email"
                      />
                    </div>

                    {!isLogin && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="username" className="text-sm">
                            Username
                          </Label>
                          <Input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            className="input-mobile bg-secondary"
                            placeholder="johndoe"
                            autoComplete="username"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="displayName" className="text-sm">
                            Display Name
                          </Label>
                          <Input
                            id="displayName"
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            required
                            className="input-mobile bg-secondary"
                            placeholder="John Doe"
                            autoComplete="name"
                          />
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-sm">
                        Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="input-mobile bg-secondary pr-10"
                          placeholder="••••••••"
                          autoComplete={isLogin ? "current-password" : "new-password"}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {isLogin && (
                        <div className="flex justify-end pt-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setAuthErrorBanner(null);
                              setAuthSuccessBanner(null);
                              setAuthMethod("forgot-password");
                            }}
                            className="text-xs text-primary hover:underline"
                          >
                            Forgot password?
                          </button>
                        </div>
                      )}
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-gradient-primary shadow-glow touch-target-lg h-12"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Please wait...
                        </>
                      ) : (
                        <>
                          <Mail className="w-5 h-5 mr-2" />
                          {isLogin ? "Sign In with Email" : "Sign Up with Email"}
                        </>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                {/* Phone Tab */}
                {SHOW_PHONE_LOGIN && (
                  <TabsContent value="phone" className="mt-4">
                    <form onSubmit={handleSendOtp} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="phone" className="text-sm">
                          Phone Number
                        </Label>
                        <Input
                          id="phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          required
                          className="input-mobile bg-secondary"
                          placeholder="+1234567890"
                          autoComplete="tel"
                        />
                        <p className="text-xs text-muted-foreground">
                          Include country code (e.g., +1 for US, +91 for India)
                        </p>
                      </div>

                      <Button
                        type="submit"
                        className="w-full bg-gradient-primary shadow-glow touch-target-lg h-12"
                        disabled={loading}
                      >
                        {loading ? (
                          <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            Sending OTP...
                          </>
                        ) : (
                          <>
                            <Phone className="w-5 h-5 mr-2" />
                            Continue with Phone
                          </>
                        )}
                      </Button>
                    </form>
                  </TabsContent>
                )}
              </Tabs>

              {/* Divider */}
              <div className="relative my-6">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
                  or continue with
                </span>
              </div>

              {/* Google OAuth Button */}
              <Button
                type="button"
                variant="outline"
                className="w-full touch-target-lg h-12 gap-3"
                onClick={handleGoogleAuth}
                disabled={loading}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </Button>

              {/* Toggle Login/Signup */}
              <div className="mt-6 text-center">
                <button
                  onClick={() => {
                    setAuthErrorBanner(null);
                    setIsLogin(!isLogin);
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors touch-target py-2"
                >
                  {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                </button>
              </div>
            </>
          )}

          <div className="mt-6 pt-4 border-t border-border/60 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
            <Link to="/privacy" className="hover:text-foreground underline-offset-2 hover:underline">
              Privacy Policy
            </Link>
            <span>&middot;</span>
            <Link to="/terms" className="hover:text-foreground underline-offset-2 hover:underline">
              Terms
            </Link>
            <span>&middot;</span>
            <Link to="/delete-account" className="hover:text-foreground underline-offset-2 hover:underline">
              Delete Account
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
};

export default Auth;
