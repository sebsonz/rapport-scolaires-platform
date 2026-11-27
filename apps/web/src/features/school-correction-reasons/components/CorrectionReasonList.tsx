import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  CorrectionReason,
  CorrectionReasonPermissions,
} from '../types/correctionReasons.types';
import CorrectionReasonPreview from './CorrectionReasonPreview';

type Props = {
  reasons: CorrectionReason[];
  selectedId: string | null;
  permissions: CorrectionReasonPermissions;
  onSelect: (reason: CorrectionReason) => void;
  onCreate: () => void;
  onEdit: (reason: CorrectionReason) => void;
  onDelete: (reason: CorrectionReason) => void;
};

export default function CorrectionReasonList({
  reasons,
  selectedId,
  permissions,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
}: Props) {
  return (
    <section className="scr-list-panel">
      <div className="scr-list-heading">
        <div>
          <h3>Motifs enregistrés</h3>
          <span>{reasons.length} motif(s)</span>
        </div>
        {permissions.canCreate && (
          <button type="button" className="scr-primary-button" onClick={onCreate}>
            <Plus size={16} />
            Nouveau motif
          </button>
        )}
      </div>

      {reasons.length === 0 ? (
        <div className="scr-empty">
          <Eye size={25} />
          <b>Aucun motif enregistré</b>
          <p>Les motifs de modification de cet établissement apparaîtront ici.</p>
        </div>
      ) : (
        <div className="scr-reason-list">
          {reasons.map(reason => (
            <article
              key={reason.id}
              className={`scr-reason-item${selectedId === reason.id ? ' is-selected' : ''}`}
            >
              <button
                type="button"
                className="scr-reason-content"
                onClick={() => onSelect(reason)}
              >
                <span className="scr-reason-title">{reason.title}</span>
                <span className="scr-reason-date">
                  Modifié le {new Date(reason.updated_at).toLocaleDateString('fr-FR')}
                </span>
                <CorrectionReasonPreview
                  contentHtml={reason.content_html}
                  className="scr-reason-excerpt"
                />
              </button>

              <div className="scr-reason-actions">
                <button
                  type="button"
                  aria-label={`Consulter ${reason.title}`}
                  title="Consulter"
                  onClick={() => onSelect(reason)}
                >
                  <Eye size={16} />
                </button>
                {permissions.canUpdate && (
                  <button
                    type="button"
                    aria-label={`Modifier ${reason.title}`}
                    title="Modifier"
                    onClick={() => onEdit(reason)}
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {permissions.canDelete && (
                  <button
                    type="button"
                    className="is-danger"
                    aria-label={`Supprimer ${reason.title}`}
                    title="Supprimer"
                    onClick={() => onDelete(reason)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}