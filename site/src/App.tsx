import { Link, NavLink, Route, Routes } from 'react-router-dom';
import BrowsePage from './pages/BrowsePage';
import HowItWorksPage from './pages/HowItWorksPage';
import ReviewPage from './pages/ReviewPage';
import './app.css';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="wordmark">
            AI&nbsp;301 <span>Issue Finder</span>
          </Link>
          <nav>
            <NavLink to="/" end>
              Browse
            </NavLink>
            <NavLink to="/how">How it works</NavLink>
            <NavLink to="/review">Staff review</NavLink>
          </nav>
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/how" element={<HowItWorksPage />} />
          <Route path="/review" element={<ReviewPage />} />
        </Routes>
      </main>
      <footer className="app-footer">
        A student-built tool for the CodePath AI&nbsp;301 course · MIT License ©
        2026 CodePath ·{' '}
        <a
          href="https://github.com/MatthewOscar/Candidate-Issue-Tracker"
          target="_blank"
          rel="noreferrer"
        >
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
