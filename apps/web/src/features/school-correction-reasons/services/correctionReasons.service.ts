import { supabase } from '../../../lib/supabase';
import type {
  CorrectionReason,
  CreateCorrectionReasonInput,
  UpdateCorrectionReasonInput,
} from '../types/correctionReasons.types';

const TABLE = 'school_correction_reasons';

function getClient() {
  if (!supabase) {
    throw new Error('La connexion Supabase est indisponible.');
  }

  return supabase;
}

export async function listCorrectionReasons(
  schoolId: string,
): Promise<CorrectionReason[]> {
  if (!schoolId) return [];

  const { data, error } = await getClient()
    .from(TABLE)
    .select('id,school_id,title,content_html,created_by,created_at,updated_at')
    .eq('school_id', schoolId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CorrectionReason[];
}

export async function createCorrectionReason(
  input: CreateCorrectionReasonInput,
): Promise<CorrectionReason> {
  const { data, error } = await getClient()
    .from(TABLE)
    .insert({
      school_id: input.school_id,
      title: input.title.trim(),
      content_html: input.content_html,
    })
    .select('id,school_id,title,content_html,created_by,created_at,updated_at')
    .single();

  if (error) throw new Error(error.message);
  return data as CorrectionReason;
}

export async function updateCorrectionReason(
  id: string,
  input: UpdateCorrectionReasonInput,
): Promise<CorrectionReason> {
  const { data, error } = await getClient()
    .from(TABLE)
    .update({
      title: input.title.trim(),
      content_html: input.content_html,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id,school_id,title,content_html,created_by,created_at,updated_at')
    .single();

  if (error) throw new Error(error.message);
  return data as CorrectionReason;
}

export async function deleteCorrectionReason(id: string): Promise<void> {
  const { error } = await getClient()
    .from(TABLE)
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
}