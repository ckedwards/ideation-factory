import type { RequirementCheck } from './idea.ts'
import './RequirementList.css'

// Each requirement with a mark for where it stands: ✓ met, ○ not yet,
// ⚠ broken. The mark and the words carry it, not the color.
export function RequirementList({ checks }: { checks: RequirementCheck[] }) {
  return (
    <ul className="requirements">
      {checks.map((check) => {
        const state = check.broken ? 'broken' : check.met ? 'met' : 'open'
        return (
          <li key={check.text} className={`requirement-${state}`}>
            <span className="requirement-mark" aria-hidden>
              {check.broken ? '⚠' : check.met ? '✓' : '○'}
            </span>
            <span>
              <span className="visually-hidden">
                {check.broken ? 'Needs fixing: ' : check.met ? 'Met: ' : 'Not met yet: '}
              </span>
              {check.text}
              {check.progress && <span className="requirement-progress"> ({check.progress})</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
