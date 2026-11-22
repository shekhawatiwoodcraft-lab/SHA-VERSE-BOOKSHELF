import { useAuth } from '@/contexts/AuthContext';
import { Navigate, useLocation } from 'react-router-dom';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    const hasOAuthError =
      /(?:^|[?&])error(?:_description)?=/.test(location.search) ||
      /(?:^|[#&])error(?:_description)?=/.test(location.hash);
    const target = hasOAuthError
      ? `/auth${location.search}${location.hash}`
      : "/auth";
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
};
