import { useCallback, useEffect, useState } from 'react';
import {
  createCorrectionReason,
  deleteCorrectionReason,
  listCorrectionReasons,
  updateCorrectionReason,
} from '../services/correctionReasons.service';
import type {
  CorrectionReason,
  CreateCorrectionReasonInput,
  UpdateCorrectionReasonInput,
} from '../types/correctionReasons.types';

export function useCorrectionReasons(schoolId: string) {
  const [reasons, setReasons] = useState<CorrectionReason[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!schoolId) {
      setReasons([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await listCorrectionReasons(schoolId);
      setReasons(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger les motifs de modification.',
      );
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async (input: CreateCorrectionReasonInput) => {
    setBusy(true);
    setError('');

    try {
      const created = await createCorrectionReason(input);
      setReasons(current => [created, ...current]);
      return created;
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Impossible de créer le motif.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const update = useCallback(async (
    id: string,
    input: UpdateCorrectionReasonInput,
  ) => {
    setBusy(true);
    setError('');

    try {
      const updated = await updateCorrectionReason(id, input);
      setReasons(current => current.map(reason =>
        reason.id === id ? updated : reason,
      ));
      return updated;
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Impossible de modifier le motif.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    setError('');

    try {
      await deleteCorrectionReason(id);
      setReasons(current => current.filter(reason => reason.id !== id));
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Impossible de supprimer le motif.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    reasons,
    loading,
    busy,
    error,
    refresh,
    create,
    update,
    remove,
  };
}