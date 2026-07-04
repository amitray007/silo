import { ThemeToggle } from './theme/ThemeToggle';

export function App() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '16px 20px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span className="silo-grain-dot" />
        <span style={{ fontWeight: 500, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>silo</span>
      </div>
      <ThemeToggle />
    </div>
  );
}
