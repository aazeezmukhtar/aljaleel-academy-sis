/**
 * Computes the total score and assigns a grade based on the scale.
 * @param {number} ca1 - Continuous Assessment 1
 * @param {number} ca2 - Continuous Assessment 2
 * @param {number} exam - Examination Score
 * @returns {object} { total, grade }
 */
const getGrade = (total) => {
    if (total >= 70) return 'A';
    if (total >= 60) return 'B';
    if (total >= 50) return 'C';
    if (total >= 40) return 'D';
    if (total >= 30) return 'E';
    return 'F';
};

const computeResult = (ca1 = 0, ca2 = 0, exam = 0) => {
    const total = (parseFloat(ca1) || 0) + (parseFloat(ca2) || 0) + (parseFloat(exam) || 0);
    const grade = getGrade(total);
    return { total, grade };
};

module.exports = { computeResult, getGrade };

