import './color-field.css';
export default function ColorField({ id, label, value, onChange }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
}) {
  return <div className="property-label property-color-field"><label htmlFor={id}>{label}</label><input id={id} type="color" value={value} title={value.toUpperCase()} onChange={event => onChange(event.target.value)}/></div>;
}
