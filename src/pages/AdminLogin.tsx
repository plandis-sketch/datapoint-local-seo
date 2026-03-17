import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const ADMIN_PASSWORD = 'masters2026'; // TODO: move to env var or Firebase config

export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();

  if (user?.isAdmin) {
    navigate('/admin/tournament');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      await updateUser({ isAdmin: true });
      navigate('/admin/tournament');
    } else {
      setError('Invalid admin password.');
    }
  };

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="bg-white rounded-xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Admin Access</h1>
        <p className="text-gray-500 mb-6">Enter the admin password to access management tools.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-masters-green focus:border-transparent outline-none"
          />
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <button
            type="submit"
            className="w-full bg-masters-green text-white py-3 rounded-lg font-semibold hover:bg-masters-dark transition"
          >
            Enter Admin Panel
          </button>
        </form>
      </div>
    </div>
  );
}
