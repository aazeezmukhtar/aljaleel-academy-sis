const db = require('../../utils/db');

const getFinanceDashboard = async (req, res) => {
    const user = req.session.staff;
    if (user.role !== 'Admin' && user.role !== 'Bursar') return res.status(403).send('Access Denied');

    const stats = {
        total_payment_today: 0,
        outstanding_fees: 0, 
        total_collected_session: 0 
    };

    try {
        const dateSql = db.DB_TYPE === 'postgres' 
            ? "SELECT SUM(amount_paid) as total FROM payments WHERE payment_date = CURRENT_DATE"
            : "SELECT SUM(amount_paid) as total FROM payments WHERE payment_date = DATE('now')";
            
        const todayResult = await db.get(dateSql);
        stats.total_payment_today = todayResult?.total || 0;

        const collectionResult = await db.get("SELECT SUM(amount_paid) as total_collected FROM payments");
        stats.total_collected_session = collectionResult?.total_collected || 0;
    } catch (e) { 
        console.log('Finance stats error', e.message); 
    }

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

    try {
        let classes = await db.all('SELECT * FROM classes');
        let students = [];

        if (class_id) {
            const query = `
                SELECT s.id, s.first_name, s.last_name, s.admission_number, c.name as class_name,
                    (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE student_id = s.id) as paid_amount,
                    (SELECT COALESCE(SUM(total_amount), 0) FROM student_fees WHERE student_id = s.id) as total_payable
                FROM students s
                JOIN classes c ON s.current_class_id = c.id
                WHERE s.current_class_id = ? AND s.status = 'active'
            `;

            const rawStudents = await db.all(query, [class_id]);
            students = rawStudents.map(s => {
                s.balance = s.total_payable - s.paid_amount;
                s.status = s.balance <= 0 ? 'Paid' : (s.paid_amount > 0 ? 'Partial' : 'Unpaid');
                return s;
            });

            if (status) {
                students = students.filter(s => s.status === status);
            }
        }

        res.render('reports/finance/status', {
            title: 'Fee Status Report',
            classes,
            students,
            user,
            query: { class_id, status }
        });
    } catch (err) {
        console.error('Fee Status Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getDebtorsList = async (req, res) => {
    const { min_debt } = req.query;
    const user = req.session.staff;
    if (user.role !== 'Admin' && user.role !== 'Bursar') return res.status(403).send('Access Denied');

    const threshold = min_debt || 1;

    try {
        // Find students where total_payable > paid_amount
        const debtors = await db.all(`
            SELECT 
                s.first_name, s.last_name, s.admission_number, c.name as class_name,
                (SELECT COALESCE(SUM(total_amount), 0) FROM student_fees WHERE student_id = s.id) as payable,
                (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE student_id = s.id) as paid
            FROM students s
            JOIN classes c ON s.current_class_id = c.id
            WHERE s.status = 'active'
            GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name
            HAVING (SUM((SELECT COALESCE(total_amount, 0) FROM student_fees WHERE student_id = s.id)) - SUM((SELECT COALESCE(amount_paid, 0) FROM payments WHERE student_id = s.id))) >= ?
            OR ((SELECT COALESCE(SUM(total_amount), 0) FROM student_fees WHERE student_id = s.id) - (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE student_id = s.id)) >= ?
            ORDER BY (payable - paid) DESC
        `, [threshold, threshold]);
        
        // Wait, the HAVING clause above is messy. Let's simplify with a subquery or better GROUP BY.
        // Actually, the original one was using s.id but in PG we need all columns in GROUP BY.
        // Let's use a cleaner approach.
        
        const debtorsClean = await db.all(`
            SELECT * FROM (
                SELECT 
                    s.first_name, s.last_name, s.admission_number, c.name as class_name,
                    (SELECT COALESCE(SUM(total_amount), 0) FROM student_fees WHERE student_id = s.id) as payable,
                    (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE student_id = s.id) as paid
                FROM students s
                JOIN classes c ON s.current_class_id = c.id
                WHERE s.status = 'active'
            ) as sub
            WHERE (payable - paid) >= ?
            ORDER BY (payable - paid) DESC
        `, [threshold]);

        debtorsClean.forEach(d => d.debt = d.payable - d.paid);

        res.render('reports/finance/debtors', {
            title: 'Debtors List',
            debtors: debtorsClean,
            user,
            query: { min_debt: threshold }
        });
    } catch (err) {
        console.error('Debtors List Error:', err);
        res.status(500).send('Database Error');
    }
};

module.exports = {
    getFinanceDashboard,
    getFeeStatusReport,
    getDebtorsList
};
