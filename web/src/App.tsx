import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, type Me } from './api';
import { Icon, Spinner, ToastHost } from './components/ui';
import Login from './pages/Login';
import RecipeList from './pages/RecipeList';
import AddRecipe from './pages/AddRecipe';
import RecipeView from './pages/RecipeView';
import RecipeEdit from './pages/RecipeEdit';
import History from './pages/History';
import Planner from './pages/Planner';
import Shopping, { ShoppingListView } from './pages/Shopping';
import Settings from './pages/Settings';

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;

export default function App() {
  const [me, setMe] = useState<Me | null | 'anon'>(null);
  const loc = useLocation();

  useEffect(() => {
    if (loc.pathname.startsWith('/login')) {
      setMe('anon');
      return;
    }
    api.get<Me>('/me').then(setMe).catch(() => setMe('anon'));
    // only on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (me === null) return <Spinner />;
  if (me === 'anon') {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  const hideChrome = /\/cook$/.test(loc.pathname);

  return (
    <MeContext.Provider value={me}>
      <div className="app">
        <Routes>
          <Route path="/" element={<RecipeList />} />
          <Route path="/login" element={<Navigate to="/" />} />
          <Route path="/add" element={<AddRecipe />} />
          <Route path="/recipes/:id" element={<RecipeView />} />
          <Route path="/recipes/:id/cook" element={<RecipeView cookMode />} />
          <Route path="/recipes/:id/edit" element={<RecipeEdit />} />
          <Route path="/recipes/:id/history" element={<History />} />
          <Route path="/plan" element={<Planner />} />
          <Route path="/shopping" element={<Shopping />} />
          <Route path="/shopping/:id" element={<ShoppingListView />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
      {!hideChrome && (
        <nav className="tabbar">
          <NavLink to="/" end aria-label="Recipes">{Icon.book}<span className="label">Recipes</span></NavLink>
          <NavLink to="/add" aria-label="Add">{Icon.plus}<span className="label">Add</span></NavLink>
          <NavLink to="/plan" aria-label="Plan">{Icon.calendar}<span className="label">Plan</span></NavLink>
          <NavLink to="/shopping" aria-label="Shopping">{Icon.basket}<span className="label">Shopping</span></NavLink>
          <NavLink to="/settings" aria-label="Settings">{Icon.gear}<span className="label">Settings</span></NavLink>
        </nav>
      )}
      <ToastHost />
    </MeContext.Provider>
  );
}

export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <NavLink to="/" className="brand">Scullery<span className="dot">.</span></NavLink>
      <div className="row">{children}</div>
    </header>
  );
}
