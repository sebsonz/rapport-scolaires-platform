export type EnrollmentOperation = { initial: number; ratissage: number; corrections: number };
export type DeliveryOperation = {
  initial: number;
  ratissage: number;
  correctionFirstIssue: number;
  reprints: number;
};
export type ClassMetrics = {
  capacity: number;
  enrollment: EnrollmentOperation;
  delivery: DeliveryOperation;
  enrolledTotal: number;
  enrolledRemaining: number;
  deliveredUnique: number;
  deliveryRemaining: number;
  enrollmentRate: number | null;
  deliveryRate: number | null;
  anomalies: string[];
};

const nonNegative = (value: number, field: string) => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} doit être un entier positif ou nul.`);
  return value;
};

export function calculateClassMetrics(
  capacity: number,
  enrollment: EnrollmentOperation,
  delivery: DeliveryOperation,
): ClassMetrics {
  nonNegative(capacity, 'Effectif total');
  Object.entries(enrollment).forEach(([key, value]) => nonNegative(value, key));
  Object.entries(delivery).forEach(([key, value]) => nonNegative(value, key));

  const enrolledTotal = enrollment.initial + enrollment.ratissage;
  const deliveredUnique = delivery.initial + delivery.ratissage + delivery.correctionFirstIssue;
  const enrolledRemaining = capacity - enrolledTotal;
  const deliveryRemaining = enrolledTotal - deliveredUnique;
  const anomalies: string[] = [];

  if (enrolledTotal > capacity) anomalies.push('Le total réellement enrôlé dépasse l’effectif total.');
  if (deliveredUnique > enrolledTotal) anomalies.push('Le total livré dépasse le total réellement enrôlé.');

  return {
    capacity,
    enrollment,
    delivery,
    enrolledTotal,
    enrolledRemaining,
    deliveredUnique,
    deliveryRemaining,
    enrollmentRate: capacity === 0 || enrolledTotal > capacity ? null : (enrolledTotal / capacity) * 100,
    deliveryRate: enrolledTotal === 0 || deliveredUnique > enrolledTotal ? null : (deliveredUnique / enrolledTotal) * 100,
    anomalies,
  };
}

export function calculateDepartmentTotals(rows: ClassMetrics[]) {
  const totals = rows.reduce((acc, row) => ({
    capacity: acc.capacity + row.capacity,
    enrolledInitial: acc.enrolledInitial + row.enrollment.initial,
    enrolledRatissage: acc.enrolledRatissage + row.enrollment.ratissage,
    enrollmentCorrections: acc.enrollmentCorrections + row.enrollment.corrections,
    enrolledTotal: acc.enrolledTotal + row.enrolledTotal,
    deliveredUnique: acc.deliveredUnique + row.deliveredUnique,
    deliveryReprints: acc.deliveryReprints + row.delivery.reprints,
  }), {
    capacity: 0, enrolledInitial: 0, enrolledRatissage: 0, enrollmentCorrections: 0,
    enrolledTotal: 0, deliveredUnique: 0, deliveryReprints: 0,
  });
  const hasAnomalies = rows.some(row => row.anomalies.length > 0);
  return {
    ...totals,
    enrolledRemaining: totals.capacity - totals.enrolledTotal,
    deliveryRemaining: totals.enrolledTotal - totals.deliveredUnique,
    enrollmentRate: totals.capacity === 0 || hasAnomalies ? null : totals.enrolledTotal / totals.capacity * 100,
    deliveryRate: totals.enrolledTotal === 0 || hasAnomalies ? null : totals.deliveredUnique / totals.enrolledTotal * 100,
    anomalyCount: rows.reduce((sum, row) => sum + row.anomalies.length, 0),
  };
}
