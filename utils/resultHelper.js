/**
 * Computes a result from the assessment marks that are actually present.
 * Blank/null assessments are excluded from display and contribute no points.
 * A result with no recorded assessment marks remains ungraded.
 */
const getGrade = (total) => {
    if (total >= 70) return 'A';
    if (total >= 60) return 'B';
    if (total >= 50) return 'C';
    if (total >= 40) return 'D';
    if (total >= 30) return 'E';
    return 'F';
};

const computeResult = (...scores) => {
    const available = scores
        .filter(value => value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === ''))
        .map(value => Number(value))
        .filter(Number.isFinite);

    if (available.length === 0) return { total: null, grade: null };

    const rawTotal = available.reduce((sum, value) => sum + value, 0);
    const total = Number.isInteger(rawTotal) ? rawTotal : Number(rawTotal.toFixed(1));
    return { total, grade: getGrade(total) };
};

module.exports = { computeResult, getGrade };
