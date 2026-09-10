import type { SnapAnchor, SnapGuides } from '../monitor-snap';
import './monitor-snap.css';

const offset = (anchor: SnapAnchor) => anchor === 'start' ? '0%' : anchor === 'end' ? '100%' : '50%';
export default function MonitorSnapGuides({ guides }: { guides: SnapGuides }) {
  return <div className="monitor-snap-guides" aria-hidden="true">
    {guides.x && <i className="monitor-snap-guide vertical" data-snap-x={guides.x} style={{ left: offset(guides.x) }} />}
    {guides.y && <i className="monitor-snap-guide horizontal" data-snap-y={guides.y} style={{ top: offset(guides.y) }} />}
  </div>;
}
