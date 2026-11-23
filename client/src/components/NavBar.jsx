import { useAuth } from '../context/AuthContext';
import { useNavigate, NavLink } from 'react-router-dom';

export default function NavBar() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/auth');
  }

  // NavLink automatically adds aria-current="page" on the active route.
  // The CSS selector [aria-current="page"] is used instead of .active.
  return (
    <header className="navbar" role="banner">
      <div className="navbar-inner">
        <NavLink to="/dashboard" className="navbar-brand" aria-label="LabShare home">
          <span className="brand-icon" aria-hidden="true">⚗</span>
          <span>LabShare</span>
        </NavLink>

        <nav aria-label="Main navigation">
          <ul className="nav-list" role="list">
            <li><NavLink to="/dashboard">Dashboard</NavLink></li>
            <li><NavLink to="/equipment">Equipment</NavLink></li>
            {profile?.role === 'student' && (
              <li><NavLink to="/requests/new">Book Equipment</NavLink></li>
            )}
            {(profile?.role === 'faculty' || profile?.role === 'admin') && (
              <li><NavLink to="/approvals">Approvals</NavLink></li>
            )}
          </ul>
        </nav>

        <div className="nav-user">
          {profile && (
            <span className="nav-profile" aria-label={`Signed in as ${profile.name}`}>
              <span className="nav-avatar" aria-hidden="true">
                {profile.name.charAt(0).toUpperCase()}
              </span>
              <span className="nav-name">{profile.name}</span>
              <span className="nav-role-badge">{profile.role}</span>
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
