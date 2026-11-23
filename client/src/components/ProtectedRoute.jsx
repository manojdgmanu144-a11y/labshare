import { useAuth } from '../context/AuthContext';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Wraps a route so only authenticated users can access it.
 * Optional `role` prop further restricts by role ('faculty', 'student', 'admin').
 * Shows nothing while session is still loading to avoid flash-of-wrong-content.
 */
export default function ProtectedRoute({ children, role }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!session) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (role && profile?.role !== role) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
