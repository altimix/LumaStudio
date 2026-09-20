export default function TextColorField({ id, label, value, onChange }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
}) {
  return <div className="property-label text-color-field"><label htmlFor={id}>{label}</label><input id={id} type="color" value={value} onChange={event => onChange(event.target.value)}/></div>;
}
