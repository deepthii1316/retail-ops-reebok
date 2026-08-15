'use client';

const reportTypes = [
  {
    id: 'sales',
    icon: '📈',
    name: 'Sales',
    description: 'Bill-Wise Item List',
  },
  {
    id: 'inventory',
    icon: '📦',
    name: 'Inventory',
    description: 'Stock Item Report',
  },
  {
    id: 'account_dsr',
    icon: '💳',
    name: 'Account DSR',
    description: 'Payment Mode Split',
  },
];

export default function ReportTypeSelector({ selectedType, onSelect }) {
  return (
    <div>
      <p className="section-label">Report Type</p>
      <div className="report-types-grid">
        {reportTypes.map((type) => (
          <button
            key={type.id}
            className={`report-type-card ${selectedType === type.id ? 'selected' : ''}`}
            onClick={() => onSelect(type.id)}
            type="button"
          >
            <div className="report-type-icon">{type.icon}</div>
            <span className="report-type-name">{type.name}</span>
            <span className="report-type-desc">{type.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
