export default function StatCard({ label, value, sub, variant = '' }) {
  return (
    <div className={`stat-card ${variant}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
