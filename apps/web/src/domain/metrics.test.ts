import { describe, expect, it } from 'vitest';
import { calculateClassMetrics, calculateDepartmentTotals } from './metrics';

describe('validated school-report metrics', () => {
  it('adds ratissage to real enrollment but never adds file corrections', () => {
    const result = calculateClassMetrics(72,
      { initial: 58, ratissage: 14, corrections: 3 },
      { initial: 65, ratissage: 5, correctionFirstIssue: 2, reprints: 4 },
    );
    expect(result.enrolledTotal).toBe(72);
    expect(result.enrolledRemaining).toBe(0);
    expect(result.deliveredUnique).toBe(72);
    expect(result.deliveryRemaining).toBe(0);
    expect(result.enrollmentRate).toBe(100);
    expect(result.deliveryRate).toBe(100);
  });

  it('excludes reprints from unique deliveries and delivery rate', () => {
    const result = calculateClassMetrics(80,
      { initial: 70, ratissage: 5, corrections: 4 },
      { initial: 60, ratissage: 10, correctionFirstIssue: 2, reprints: 20 },
    );
    expect(result.deliveredUnique).toBe(72);
    expect(result.delivery.reprints).toBe(20);
    expect(result.deliveryRate).toBeCloseTo(96, 6);
  });

  it('marks enrollment over 100 percent as an anomaly instead of displaying it as a valid rate', () => {
    const result = calculateClassMetrics(72,
      { initial: 58, ratissage: 15, corrections: 0 },
      { initial: 60, ratissage: 10, correctionFirstIssue: 0, reprints: 0 },
    );
    expect(result.anomalies).toHaveLength(1);
    expect(result.enrollmentRate).toBeNull();
    expect(result.deliveryRate).toBeNull();
  });

  it('aggregates department totals without counting corrections or reprints as unique people', () => {
    const a = calculateClassMetrics(72,
      { initial: 58, ratissage: 12, corrections: 2 },
      { initial: 60, ratissage: 8, correctionFirstIssue: 0, reprints: 3 },
    );
    const b = calculateClassMetrics(65,
      { initial: 60, ratissage: 5, corrections: 1 },
      { initial: 50, ratissage: 10, correctionFirstIssue: 2, reprints: 4 },
    );
    const total = calculateDepartmentTotals([a, b]);
    expect(total.capacity).toBe(137);
    expect(total.enrolledTotal).toBe(135);
    expect(total.deliveredUnique).toBe(130);
    expect(total.enrollmentCorrections).toBe(3);
    expect(total.deliveryReprints).toBe(7);
    expect(total.enrollmentRate).toBeCloseTo(98.5401459, 5);
    expect(total.deliveryRate).toBeCloseTo(96.2962963, 5);
  });
});
