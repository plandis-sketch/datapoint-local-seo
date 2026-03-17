import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Profile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  if (!user) return null;

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Profile</h1>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-masters-green flex items-center justify-center">
            <span className="text-2xl font-bold text-masters-yellow">
              {user.displayName ? user.displayName[0].toUpperCase() : '?'}
            </span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{user.displayName || 'No name set'}</h2>
            <p className="text-gray-500 text-sm">{user.email}</p>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Role</span>
            <span className="font-medium">{user.isAdmin ? 'Administrator' : 'Participant'}</span>
          </div>
        </div>

        <button
          onClick={handleSignOut}
          className="mt-6 w-full bg-red-50 text-red-600 py-3 rounded-lg font-semibold hover:bg-red-100 transition"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
