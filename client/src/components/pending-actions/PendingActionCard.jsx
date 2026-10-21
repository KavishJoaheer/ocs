import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, Check, CheckCircle2, ClipboardList, Clock3, FileText, History, House, MoreHorizontal, Package, UserRound, Video } from "lucide-react";

function taskAppearance(task) {
  if (task.source_type === "visit") return { Icon: House, label: "Home visit" };
  if (task.source_type === "teleconsultation") return { Icon: Video, label: "Teleconsultation" };
  if (task.source_type === "review") return { Icon: CalendarDays, label: "Review appointment" };
  if (task.source_type === "report") return { Icon: FileText, label: "Report review" };
  if (task.source_type === "supply") return { Icon: Package, label: "Supply request" };
  return { Icon: ClipboardList, label: "Team task" };
}

export default function PendingActionCard({ task, user, busy, selected, onAcknowledge, onAsk, onHistory, formatTime, children }) {
  const { Icon, label } = taskAppearance(task);
  const resolved = task.status === "resolved";
  const acknowledged = task.status === "acknowledged";
  const canAcknowledge = !resolved && task.can_acknowledge && !acknowledged;
  const canHandOver = !resolved && task.can_act && !task.clinical_owner_id;
  const canDecline = !resolved && task.kind === "doctor_assignment" && Number(task.clinical_owner_id) === Number(user.id) && !user.is_read_only;
  return (
    <article aria-label={`Action ${task.id}`} className="pending-action-card" data-attention={!resolved && (task.overdue || task.priority === "urgent" || task.escalation_level > 0)}>
      <div className="pending-action-content">
        <span className="pending-action-icon" aria-hidden="true">{resolved ? <CheckCircle2 size={21} /> : <Icon size={21} />}</span>
        <div className="pending-action-details">
          <div className="pending-action-heading">
            <span className="pending-action-category">{label}</span>
            <span className={`pending-action-badge ${resolved ? "is-resolved" : acknowledged ? "is-progress" : "is-pending"}`}>{resolved ? "Resolved" : acknowledged ? "In progress" : "Awaiting acceptance"}</span>
            {!resolved && task.priority === "urgent" && <span className="pending-action-badge is-urgent">Urgent</span>}
            {!resolved && task.overdue && <span className="pending-action-badge is-overdue">Overdue</span>}
            {!resolved && task.escalation_level > 0 && <span className="pending-action-badge is-overdue">Escalated to supervisor · Level {task.escalation_level}</span>}
          </div>
          <h2>{task.title}</h2>
          {task.patient_name && <p className="pending-action-patient">{task.patient_name}</p>}
          <div className="pending-action-meta">
            <span><UserRound size={14} aria-hidden="true" /><span>Owner: <strong>{task.owner_name || "Needs an owner"}</strong>{Number(task.owner_user_id) === Number(user.id) ? " (you)" : ""}</span></span>
            <span><Clock3 size={14} aria-hidden="true" /><span>{resolved ? "Resolved" : task.acknowledged_at ? "Act by" : "Accept by"} <strong>{formatTime(resolved ? task.resolved_at : task.response_due_at)}</strong></span></span>
          </div>
        </div>
      </div>
      <div className="pending-action-controls">
        {canAcknowledge && <button disabled={busy} className="pending-control" title="Acknowledge receipt. The task stays open until its work is completed." onClick={onAcknowledge}><Check size={16} aria-hidden="true" />{task.owner_user_id ? "Acknowledge" : "Claim and acknowledge"}</button>}
        <Link className="pending-control pending-control-primary" to={task.url}>Open workflow<ArrowUpRight size={15} aria-hidden="true" /></Link>
        <div className="pending-action-secondary">
          <button className={`pending-control pending-history-toggle ${selected ? "is-selected" : ""}`} aria-expanded={selected} onClick={onHistory}><History size={15} aria-hidden="true" />Action history</button>
          {(canHandOver || canDecline) && <details className="pending-action-more">
            <summary className="pending-control" aria-label="More actions"><MoreHorizontal size={19} aria-hidden="true" /><span>More</span></summary>
            <div>
              {canHandOver && <button disabled={busy} onClick={() => onAsk("handover")}>Hand over</button>}
              {canDecline && <button disabled={busy} onClick={() => onAsk("decline")}>Decline assignment</button>}
            </div>
          </details>}
        </div>
      </div>
      {selected && <div className="pending-action-history">{children}</div>}
    </article>
  );
}
