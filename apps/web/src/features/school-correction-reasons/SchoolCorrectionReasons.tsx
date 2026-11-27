import { useState, type FormEvent } from 'react';
import { BookOpen, ChevronDown, ChevronUp, Eye, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { useCorrectionReasons } from './hooks/useCorrectionReasons';
import CorrectionReasonEditor from './components/CorrectionReasonEditor';
import CorrectionReasonList from './components/CorrectionReasonList';
import CorrectionReasonPreview from './components/CorrectionReasonPreview';
import type {
  CorrectionReason,
  CorrectionReasonPermissions,
} from './types/correctionReasons.types';
import './SchoolCorrectionReasons.css';

type Props = {
  schoolId: string;
  schoolName: string;
  permissions: CorrectionReasonPermissions;
};

export default function SchoolCorrectionReasons({
  schoolId,
  schoolName,
  permissions,
}: Props) {
  const {
    reasons,
    loading,
    busy,
    error,
    create,
    update,
    remove,
  } = useCorrectionReasons(schoolId);

  const [selected, setSelected] = useState<CorrectionReason | null>(null);
  const [editing, setEditing] = useState<CorrectionReason | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CorrectionReason | null>(null);
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [notice, setNotice] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!permissions.canRead) return null;

  function resetForm() {
    setShowForm(false);
    setEditing(null);
    setTitle('');
    setContentHtml('');
  }

  function startCreate() {
    setSelected(null);
    setEditing(null);
    setTitle('');
    setContentHtml('');
    setNotice('');
    setShowForm(true);
  }

  function startEdit(reason: CorrectionReason) {
    setSelected(reason);
    setEditing(reason);
    setTitle(reason.title);
    setContentHtml(reason.content_html);
    setNotice('');
    setShowForm(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');

    const cleanTitle = title.trim();
    const cleanHtml = DOMPurify.sanitize(contentHtml, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['style'],
    });

    if (!cleanTitle) {
      setNotice('Le titre du motif est obligatoire.');
      return;
    }

    if (!cleanHtml.replace(/<[^>]*>/g, '').trim()) {
      setNotice('Le contenu du motif est obligatoire.');
      return;
    }

    try {
      if (editing) {
        const updated = await update(editing.id, {
          title: cleanTitle,
          content_html: cleanHtml,
        });
        setSelected(updated);
        setNotice('Motif modifié avec succès.');
      } else {
        const created = await create({
          school_id: schoolId,
          title: cleanTitle,
          content_html: cleanHtml,
        });
        setSelected(created);
        setNotice('Motif créé avec succès.');
      }
      resetForm();
    } catch {
      // Le hook expose le message d'erreur.
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;

    try {
      await remove(confirmDelete.id);
      if (selected?.id === confirmDelete.id) setSelected(null);
      setConfirmDelete(null);
      setNotice('Motif supprimé.');
    } catch {
      setConfirmDelete(null);
    }
  }

  return (
    <section className="scr-section" id="motifs-modification">
      <div className="scr-section-heading">
        <div className="scr-section-icon"><BookOpen size={22} /></div>
        <div>
          <h2>Motifs de modification</h2>
          <p>Consultez et gérez les motifs de correction de {schoolName}.</p>
        </div>
        {!isCollapsed && !showForm && permissions.canCreate && (
          <button type="button" className="scr-primary-button" onClick={startCreate}>
            <Plus size={17} />
            Nouveau motif
          </button>
        )}
        <button
          type="button"
          className="scr-collapse-button"
          onClick={() => setIsCollapsed(value => !value)}
          aria-expanded={!isCollapsed}
          aria-controls="scr-section-body"
        >
          {isCollapsed ? <><ChevronDown size={16} /> Afficher</> : <><ChevronUp size={16} /> Masquer</>}
        </button>
      </div>

      {!isCollapsed && <div className="scr-section-body" id="scr-section-body">
      {notice && <div className="scr-notice success">{notice}</div>}
      {error && <div className="scr-notice error">{error}</div>}

      {showForm && (
        <form className="scr-form-panel" onSubmit={handleSubmit}>
          <div className="scr-form-heading">
            <div>
              <h3>{editing ? 'Modifier le motif' : 'Créer un motif'}</h3>
              <p>Rédigez une explication claire et précise de la correction.</p>
            </div>
            <button
              type="button"
              className="scr-icon-button"
              aria-label="Fermer le formulaire"
              onClick={resetForm}
            >
              <X size={18} />
            </button>
          </div>

          <label className="scr-field">
            <span>Titre du motif <b>*</b></span>
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              maxLength={180}
              placeholder="Ex. : Correction d'une erreur sur l'état civil"
              required
            />
          </label>

          <div className="scr-field">
            <span>Contenu du motif <b>*</b></span>
            <CorrectionReasonEditor
              key={editing?.id ?? 'new-reason'}
              content={contentHtml}
              onChange={setContentHtml}
            />
          </div>

          <div className="scr-form-actions">
            <button type="button" className="scr-secondary-button" onClick={resetForm}>
              Annuler
            </button>
            <button type="submit" className="scr-primary-button" disabled={busy}>
              <Save size={16} />
              {busy ? 'Enregistrement…' : editing ? 'Enregistrer les modifications' : 'Enregistrer le motif'}
            </button>
          </div>
        </form>
      )}

      <div className="scr-workspace">
        <CorrectionReasonList
          reasons={reasons}
          selectedId={selected?.id ?? null}
          permissions={permissions}
          onSelect={reason => {
            setSelected(reason);
            setShowForm(false);
          }}
          onCreate={startCreate}
          onEdit={startEdit}
          onDelete={setConfirmDelete}
        />

        <section className="scr-detail-panel">
          <div className="scr-detail-heading">
            <h3><Eye size={17} /> Aperçu du motif</h3>
            {selected && (
              <div className="scr-detail-actions">
                {permissions.canUpdate && (
                  <button
                    type="button"
                    className="scr-secondary-button"
                    onClick={() => startEdit(selected)}
                  >
                    <Pencil size={15} /> Modifier
                  </button>
                )}
                {permissions.canDelete && (
                  <button
                    type="button"
                    className="scr-danger-button"
                    onClick={() => setConfirmDelete(selected)}
                  >
                    <Trash2 size={15} /> Supprimer
                  </button>
                )}
              </div>
            )}
          </div>

          {selected ? (
            <div className="scr-detail-content">
              <h4>{selected.title}</h4>
              <p className="scr-detail-date">
                Dernière modification : {new Date(selected.updated_at).toLocaleString('fr-FR')}
              </p>
              <CorrectionReasonPreview contentHtml={selected.content_html} />
            </div>
          ) : (
            <div className="scr-empty">
              <Eye size={26} />
              <b>Sélectionnez un motif</b>
              <p>Son contenu détaillé apparaîtra dans cette zone.</p>
            </div>
          )}
        </section>
      </div>

      {loading && <div className="scr-loading">Chargement des motifs…</div>}

      {confirmDelete && (
        <div className="scr-confirm-backdrop" role="presentation">
          <div
            className="scr-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="scr-confirm-title"
          >
            <h3 id="scr-confirm-title">Confirmer la suppression</h3>
            <p>
              Voulez-vous vraiment supprimer le motif « {confirmDelete.title} » ?
              Cette action ne pourra pas être annulée.
            </p>
            <div className="scr-form-actions">
              <button
                type="button"
                className="scr-secondary-button"
                onClick={() => setConfirmDelete(null)}
                disabled={busy}
              >
                Annuler
              </button>
              <button
                type="button"
                className="scr-danger-button"
                onClick={() => void handleDelete()}
                disabled={busy}
              >
                <Trash2 size={16} />
                {busy ? 'Suppression…' : 'Confirmer la suppression'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>}
    </section>
  );
}