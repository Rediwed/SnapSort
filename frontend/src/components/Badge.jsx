export default function Badge({ children, variant = 'accent' }) {
  return <span className={`badge ${variant}`}>{children}</span>;
}
