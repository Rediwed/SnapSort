export default function PillTabs({ tabs, active, onChange }) {
  return (
    <div className="pill-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          className={`pill-tab ${active === tab.value ? 'active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && ` (${tab.count})`}
        </button>
      ))}
    </div>
  );
}
