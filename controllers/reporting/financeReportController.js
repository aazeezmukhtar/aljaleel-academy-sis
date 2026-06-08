const db = require('../../utils/db');
const { getAcademicContext } = require('../../utils/sessionHelper');

const getFinanceDashboard = async (req, res) => {
    const user = req.session.staff;
    if (user.role !== 'Admin' && user.role !== 'Bursar') return res.status(403).send('Access Denied');

    let todayQuery = "SELECT SUM(amount) as total FROM payments WHERE date = DATE('now')";
    if (db.DB_TYPE === 'postgres') {
        todayQuery = "SELECT SUM(amount) as total FROM payments WHERE date = CURRENT_DATE";
    }

    const stats = {
        total_payment_today: (await db.get(todayQuery))?.total || 0,
        outstanding_fees: 0,
        total_collected_session: 0
    };

    try {
        const result = await db.get(`
            SELECT 
                SUM(p.amount) as total_collected
            FROM payments p
        `);
        stats.total_collected_session = result.total_collected || 0;
    } catch (e) { console.log('Finance stats error', e.message); }

    res.render('reports/finance/index', {
        title: 'Finance Reports',
        stats,
        user
    });
};

const getFeeStatusReport = async (req, res) => {
    const { class_id, status } = req.query; // status: 'Paid', 'Partial', 'Unpaid'
    const user = req.session.staff;
    if (user.role !== 'Admin' && user.role !== 'Bursar') return res.status(403).send('Access Denied');

    let classes = await db.all('SELECT * FROM classes');
    let students = [];

    let activeClassId = class_id;
    if (!activeClassId && classes && classes.length > 0) {
        activeClassId = classes[0].id;
    }

    if (activeClassId) {
        let coalesceFunc = db.DB_TYPE === 'postgres' ? 'COALESCE' : 'IFNULL';
        const context = await getAcademicContext(activeClassId);
        const currentSession = context.session;

        const query = `
            SELECT s.id, s.first_name, s.last_name, s.admission_number, c.name as class_name,
                   (SELECT ${coalesceFunc}(SUM(amount), 0) FROM payments WHERE student_id = s.id) as paid_amount,
                   (SELECT ${coalesceFunc}(SUM(amount), 0) FROM student_fees WHERE student_id = s.id) as total_payable
            FROM students s
            JOIN student_enrollments se ON s.id = se.student_id AND se.session = ?
            JOIN classes c ON se.class_id = c.id
            WHERE se.class_id = ? AND s.status = 'active'
        `;

        try {
            const rawStudents = await db.all(query, [currentSession, activeClassId]);
            students = rawStudents.map(s => {
                s.balance = s.total_payable - s.paid_amount;
                s.status = s.balance <= 0 ? 'Paid' : (s.paid_amount > 0 ? 'Partial' : 'Unpaid');
                return s;
            });

            if (status) {
                students = students.filter(s => s.status === status);
            }
        } catch (e) {
            console.error('Fee Status Report Error:', e.message);
            students = [];
        }
    }

    res.render('reports/finance/status', {
        title: 'Fee Status Report',
        classes,
        students,
        query: { class_id: activeClassId, status }
    });
};

const getDebtorsList = async (req, res) => {
    const { min_debt } = req.query;
    const user = req.session.staff;
    if (user.role !== 'Admin' && user.role !== 'Bursar') return res.status(403).send('Access Denied');

    const threshold = min_debt || 1;

    let debtors = [];
    try {
        let coalesceFunc = db.DB_TYPE === 'postgres' ? 'COALESCE' : 'IFNULL';
        debtors = await db.all(`
            SELECT 
                s.id, s.first_name, s.last_name, s.admission_number,
                (SELECT ${coalesceFunc}(SUM(amount), 0) FROM student_fees WHERE student_id = s.id) as payable,
                (SELECT ${coalesceFunc}(SUM(amount), 0) FROM payments WHERE student_id = s.id) as paid
            FROM students s
            WHERE s.status = 'active'
            GROUP BY s.id, s.first_name, s.last_name, s.admission_number
            HAVING ((SELECT ${coalesceFunc}(SUM(amount), 0) FROM student_fees WHERE student_id = s.id) - (SELECT ${coalesceFunc}(SUM(amount), 0) FROM payments WHERE student_id = s.id)) >= ?
            ORDER BY (payable - paid) DESC
        `, [threshold]);

        if (debtors.length > 0) {
            const studentIds = debtors.map(d => d.id);
            const placeholders = studentIds.map(() => '?').join(',');
            const enrollments = await db.all(`
                SELECT se.student_id, c.name as class_name
                FROM student_enrollments se
                JOIN classes c ON se.class_id = c.id
                JOIN sections sec ON c.section_id = sec.id
                WHERE se.student_id IN (${placeholders}) AND se.session = sec.current_session
            `, studentIds);

            const classMap = new Map();
            enrollments.forEach(e => {
                if (!classMap.has(e.student_id)) {
                    classMap.set(e.student_id, []);
                }
                classMap.get(e.student_id).push(e.class_name);
            });

            debtors.forEach(d => {
                const classes = classMap.get(d.id) || [];
                d.class_name = classes.length > 0 ? classes.join(', ') : 'Not Enrolled';
                d.debt = d.payable - d.paid;
            });
        }

    } catch (e) { console.error('Debtors List Error:', e.message); }

    res.render('reports/finance/debtors', {
        title: 'Debtors List',
        debtors,
        query: { min_debt: threshold }
    });
};

module.exports = {
    getFinanceDashboard,
    getFeeStatusReport,
    getDebtorsList
};
