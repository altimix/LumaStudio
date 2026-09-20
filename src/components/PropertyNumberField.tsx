import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import './property-number-field.css';

export default function PropertyNumberField({ inputId, label, suffix, input, slider }: {
  inputId: string;
  label: string;
  suffix: string;
  input: ReactNode;
  slider?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const sliderId = useId();
  return <div className={`property-field ${slider && expanded ? '' : 'no-slider'}`}>
    <div className="property-label">
      <label htmlFor={inputId}>{label}</label>
      <div className="number-field-controls">
        <div className="number-wrap">{input}<span>{suffix}</span></div>
        {slider ? <button type="button" className="number-slider-toggle"
          aria-label={`${label}のスライダー`} aria-expanded={expanded} aria-controls={sliderId}
          title={expanded ? 'スライダーを折りたたむ' : 'スライダーを表示'}
          onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation(); }}
          onClick={() => setExpanded(value => !value)}><ChevronDown size={12}/></button> : null}
      </div>
    </div>
    {slider ? <div id={sliderId} className="number-slider-panel" hidden={!expanded}>{slider}</div> : null}
  </div>;
}
