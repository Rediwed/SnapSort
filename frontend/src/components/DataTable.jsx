import { Inbox } from 'lucide-react';

/**
 * Reusable table with column definitions.
 *
 * columns = [{ key, header, render?, className? }]
 */
export default function DataTable({ columns, rows, emptyMessage = 'No data', onRowClick }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><Inbox size={32} /></div>
        <h3>{emptyMessage}</h3>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.className || ''}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} onClick={onRowClick ? () => onRowClick(row) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
              {columns.map((col) => (
                <td key={col.key} className={col.className || ''}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
