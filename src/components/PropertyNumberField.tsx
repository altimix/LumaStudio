import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import './property-number-field.css';

export default function PropertyNumberField({ inputId, label, suffix, input, slider, onFocus, lineActive = false }: {
  inputId: string;
  label: string;
  suffix: string;
  input: ReactNode;
  slider?: ReactNode;
  onFocus?:()=>void;
  lineActive?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const sliderId = useId();
  return <div className={`property-field ${slider && expanded ? '' : 'no-slider'}${lineActive ? ' line-active' : ''}`} onFocusCapture={onFocus} role={lineActive ? 'group' : undefined} aria-label={lineActive ? label : undefined} aria-describedby={lineActive ? `${inputId}-line-status` : undefined}>
    <div className="property-label">
      <div className="property-field-name"><label htmlFor={inputId}>{label}</label>{lineActive ? <span id={`${inputId}-line-status`} className="property-line-status">◇ ラインに表示中</span> : null}</div>
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
