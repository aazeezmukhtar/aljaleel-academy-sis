const db = require('../../utils/db');

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

    if (class_id) {
        let coalesceFunc = db.DB_TYPE === 'postgres' ? 'COALESCE' : 'IFNULL';
        const query = `
            SELECT s.id, s.first_name, s.last_name, s.admission_number, c.name as class_name,
                   (SELECT ${coalesceFunc}(SUM(amount), 0) FROM payments WHERE student_id = s.id) as paid_amount,
                   (SELECT ${coalesceFunc}(SUM(amount), 0) FROM student_fees WHERE student_id = s.id) as total_payable
            FROM students s
            JOIN classes c ON s.current_class_id = c.id
            WHERE s.current_class_id = ? AND s.status = 'active'
        `;

        try {
            const rawStudents = await db.all(query, [class_id]);
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
        query: { class_id, status }
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
                s.first_name, s.last_name, s.admission_number, c.name as class_name,
                (SELECT ${coalesceFunc}(SUM(amount), 0) FROM student_fees WHERE student_id = s.id) as payable,
                (SELECT ${coalesceFunc}(SUM(amount), 0) FROM payments WHERE student_id = s.id) as paid
            FROM students s
            JOIN classes c ON s.current_class_id = c.id
            WHERE s.status = 'active'
            GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name
            HAVING ((SELECT ${coalesceFunc}(SUM(amount), 0) FROM student_fees WHERE student_id = s.id) - (SELECT ${coalesceFunc}(SUM(amount), 0) FROM payments WHERE student_id = s.id)) >= ?
            ORDER BY (payable - paid) DESC
        `, [threshold]);

        debtors.forEach(d => d.debt = d.payable - d.paid);

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
