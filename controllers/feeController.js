const db = require('../utils/db');
const { getAcademicContext } = require('../utils/sessionHelper');

const getSetup = async (req, res) => {
    try {
        const classes = await db.all('SELECT * FROM classes');
        const feeCategories = await db.all(`
            SELECT fc.*, c.name as class_name 
            FROM fee_categories fc
            LEFT JOIN classes c ON fc.class_id = c.id
            ORDER BY fc.session DESC, fc.term
        `);

        res.render('fees/setup', {
            title: 'Fee Structure Setup',
            classes,
            feeCategories
        });
    } catch (err) {
        console.error('Fee Setup Error:', err);
        res.status(500).send('Database Error');
    }
};

const addFeeCategory = async (req, res) => {
    const { name, amount, class_id, session, term } = req.body;
    try {
        await db.run(`
            INSERT INTO fee_categories (name, amount, class_id, session, term)
            VALUES (?, ?, ?, ?, ?)
        `, [name, amount, class_id, session, term]);
        res.redirect('/fees/setup');
    } catch (err) {
        console.error('Add Fee Category Error:', err);
        res.status(500).send('Error adding fee category');
    }
};

const getFeeManager = async (req, res) => {
    const { class_id } = req.query;
    const user = req.session.staff;
    try {
        let classes;
        if (user.role === 'Admin' || user.role === 'Bursar') {
            classes = await db.all('SELECT * FROM classes ORDER BY name');
        } else {
            classes = await db.all(`
                SELECT DISTINCT c.* FROM classes c
                JOIN class_assignments ca ON c.id = ca.class_id
                WHERE ca.staff_id = ?
                ORDER BY c.name
            `, [user.id]);
        }

        let students = [];
        if (class_id) {
            // Access control check
            if (user.role !== 'Admin' && user.role !== 'Bursar') {
                const isAssigned = classes.find(c => String(c.id) === String(class_id));
                if (!isAssigned) return res.redirect('/fees/manager?error=Unauthorized Access');
            }

            const context = await getAcademicContext(class_id);
            const currentSession = context.session;

            students = await db.all(`
                SELECT s.id, s.first_name, s.last_name, s.admission_number,
                       COALESCE(SUM(sf.total_amount), 0) as total_owed,
                       COALESCE(SUM(sf.paid_amount), 0) as total_paid
                FROM students s
                JOIN student_enrollments se ON s.id = se.student_id AND se.session = ?
                LEFT JOIN student_fees sf ON s.id = sf.student_id
                WHERE se.class_id = ? AND s.status = 'active'
                GROUP BY s.id, s.first_name, s.last_name, s.admission_number
                ORDER BY s.first_name, s.last_name
            `, [currentSession, class_id]);
        }

        res.render('fees/manager', {
            title: 'Fee Management',
            classes,
            students,
            filters: { class_id }
        });
    } catch (err) {
        console.error('Fee Manager Error:', err);
        res.status(500).send('Database Error');
    }
};

const getStudentFees = async (req, res) => {
    const { student_id } = req.params;
    const user = req.session.staff;
    try {
        const student = await db.get('SELECT * FROM students WHERE id = ?', [student_id]);
        if (!student) return res.status(404).send('Student not found');

        const enrollments = await db.all(`
            SELECT se.class_id 
            FROM student_enrollments se
            JOIN classes c ON se.class_id = c.id
            JOIN sections sec ON c.section_id = sec.id
            WHERE se.student_id = ? AND se.session = sec.current_session
        `, [student_id]);
        const enrolledClassIds = enrollments.map(e => e.class_id);

        // Access control check
        if (user.role !== 'Admin' && user.role !== 'Bursar') {
            if (enrolledClassIds.length === 0) {
                return res.redirect('/fees/manager?error=Unauthorized Access to this student');
            }
            const placeholders = enrolledClassIds.map(() => '?').join(',');
            const isAssigned = await db.get(`
                SELECT id FROM class_assignments WHERE staff_id = ? AND class_id IN (${placeholders})
            `, [user.id, ...enrolledClassIds]);
            if (!isAssigned) return res.redirect('/fees/manager?error=Unauthorized Access to this student');
        }

        const fees = await db.all(`
            SELECT sf.*, fc.name as fee_name, fc.amount as base_amount
            FROM student_fees sf
            JOIN fee_categories fc ON sf.fee_category_id = fc.id
            WHERE sf.student_id = ?
        `, [student_id]);

        let availableFees = [];
        if (enrolledClassIds.length > 0) {
            const placeholders = enrolledClassIds.map(() => '?').join(',');
            availableFees = await db.all(`
                SELECT * FROM fee_categories 
                WHERE (class_id = 0 OR class_id IN (${placeholders}))
                AND id NOT IN (SELECT fee_category_id FROM student_fees WHERE student_id = ?)
            `, [...enrolledClassIds, student_id]);
        } else {
            availableFees = await db.all(`
                SELECT * FROM fee_categories 
                WHERE class_id = 0
                AND id NOT IN (SELECT fee_category_id FROM student_fees WHERE student_id = ?)
            `, [student_id]);
        }

        res.render('fees/student-details', {
            title: 'Student Fee Details',
            student,
            fees,
            availableFees
        });
    } catch (err) {
        console.error('Student Fees Error:', err);
        res.status(500).send('Database Error');
    }
};

const assignFee = async (req, res) => {
    const { student_id, fee_category_id } = req.body;
    try {
        const fee = await db.get('SELECT amount FROM fee_categories WHERE id = ?', [fee_category_id]);
        await db.run(`
            INSERT INTO student_fees (student_id, fee_category_id, total_amount)
            VALUES (?, ?, ?)
        `, [student_id, fee_category_id, fee.amount]);
        res.redirect(`/fees/student/${student_id}`);
    } catch (err) {
        console.error('Assign Fee Error:', err);
        res.status(500).send('Error assigning fee');
    }
};

const getPayForm = async (req, res) => {
    const { student_fee_id } = req.params;
    try {
        const fee = await db.get(`
            SELECT sf.*, fc.name as fee_name, s.first_name, s.last_name, s.id as student_id
            FROM student_fees sf
            JOIN fee_categories fc ON sf.fee_category_id = fc.id
            JOIN students s ON sf.student_id = s.id
            WHERE sf.id = ?
        `, [student_fee_id]);

        res.render('fees/pay', {
            title: 'Record Payment',
            fee
        });
    } catch (err) {
        console.error('Pay Form Error:', err);
        res.status(500).send('Database Error');
    }
};

const processPayment = async (req, res) => {
    const { student_fee_id, amount_paid, payment_method } = req.body;
    const receipt_number = 'REC-' + Date.now();

    try {
        const fee = await db.get('SELECT * FROM student_fees WHERE id = ?', [student_fee_id]);
        const newPaidAmount = parseFloat(fee.paid_amount) + parseFloat(amount_paid);
        let status = 'Partial';
        if (newPaidAmount >= fee.total_amount) status = 'Paid';

        await db.transaction(async () => {
            await db.run(`
                INSERT INTO payments (student_id, student_fee_id, amount_paid, payment_method, receipt_number)
                VALUES (?, ?, ?, ?, ?)
            `, [fee.student_id, student_fee_id, amount_paid, payment_method, receipt_number]);

            await db.run(`
                UPDATE student_fees SET paid_amount = ?, status = ? WHERE id = ?
            `, [newPaidAmount, status, student_fee_id]);
        });

        res.redirect(`/fees/receipt/${receipt_number}`);

    } catch (err) {
        console.error('Process Payment Error:', err);
        res.status(500).send('Error processing payment');
    }
};

const getReceipt = async (req, res) => {
    const { receipt_number } = req.params;
    try {
        const payment = await db.get(`
            SELECT p.*, s.first_name, s.last_name, s.admission_number, fc.name as fee_name, sf.total_amount, sf.paid_amount as total_paid_to_date
            FROM payments p
            JOIN students s ON p.student_id = s.id
            JOIN student_fees sf ON p.student_fee_id = sf.id
            JOIN fee_categories fc ON sf.fee_category_id = fc.id
            WHERE p.receipt_number = ?
            `, [receipt_number]);

        if (!payment) return res.status(404).send('Receipt not found');

        res.render('fees/receipt', {
            title: 'Payment Receipt',
            payment,
            school: res.locals.school
        });
    } catch (err) {
        console.error('Receipt Error:', err);
        res.status(500).send('Database Error');
    }
};

module.exports = {
    getSetup,
    addFeeCategory,
    getFeeManager,
    getStudentFees,
    assignFee,
    getPayForm,
    processPayment,
    getReceipt
};
