export type CorrectionReason = {
  id: string;
  school_id: string;
  title: string;
  content_html: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CreateCorrectionReasonInput = {
  school_id: string;
  title: string;
  content_html: string;
};

export type UpdateCorrectionReasonInput = {
  title: string;
  content_html: string;
};

export type CorrectionReasonPermissions = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};