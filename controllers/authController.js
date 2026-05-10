const db = require('../utils/db');
const bcrypt = require('bcryptjs');
const { logAction } = require('../utils/logger');

exports.getLogin = (req, res) => {
    // If already logged in, redirect to dashboard
    if (req.session.staff) {
        return res.redirect('/dashboard');
    }
    res.render('auth/login', {
        title: 'Nexus SIS - Login',
        error: req.query.error || null
    });
};

exports.postLogin = async (req, res) => {
    const { staff_id, password } = req.body;

    if (!staff_id || !password) {
        return res.redirect('/auth/login?error=All fields are required');
    }

    try {
        const staff = await db.get('SELECT * FROM staff WHERE staff_id = ? AND status = \'active\'', [staff_id]);

        if (!staff) {
            return res.redirect('/auth/login?error=Invalid Staff ID or account inactive');
        }

        const isMatch = await bcrypt.compare(password, staff.password_hash);

        if (!isMatch) {
            return res.redirect('/auth/login?error=Invalid Password');
        }

        // Create session
        req.session.staff = {
            id: staff.id,
            staff_id: staff.staff_id,
            first_name: staff.first_name,
            last_name: staff.last_name,
            role: staff.role
        };

        // Save session and log action
        req.session.save(() => {
            logAction(staff.id, 'LOGIN', 'AUTH', { staff_id: staff.staff_id }, req.ip);
            res.redirect('/dashboard');
        });
    } catch (err) {
        console.error('Login Error:', err);
        res.redirect('/auth/login?error=System error: ' + encodeURIComponent(err.message));
    }
};

exports.logout = (req, res) => {
    const userId = req.session.staff ? req.session.staff.id : null;
    req.session.destroy((err) => {
        if (err) console.error('Logout Error:', err);
        if (userId) logAction(userId, 'LOGOUT', 'AUTH', {}, req.ip);
        res.redirect('/auth/login');
    });
};

exports.getChangePassword = (req, res) => {
    res.render('auth/change_password', {
        title: 'Change Password',
        error: req.query.error,
        success: req.query.success
    });
};

exports.postChangePassword = async (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;
    const user = req.session.staff;

    if (new_password !== confirm_password) {
        return res.redirect('/auth/change-password?error=Passwords do not match');
    }

    try {
        const staff = await db.get('SELECT * FROM staff WHERE id = ?', [user.id]);
        const isMatch = await bcrypt.compare(current_password, staff.password_hash);

        if (!isMatch) {
            return res.redirect('/auth/change-password?error=Incorrect current password');
        }

        const hashed = await bcrypt.hash(new_password, 10);
        await db.run('UPDATE staff SET password_hash = ? WHERE id = ?', [hashed, user.id]);

        logAction(user.id, 'CHANGE_PASSWORD', 'AUTH', {}, req.ip);
        res.redirect('/auth/change-password?success=Password changed successfully');
    } catch (err) {
        console.error('Change Password Error:', err);
        res.redirect('/auth/change-password?error=System error occurred');
    }
};

exports.getStudentLogin = (req, res) => {
    if (req.session.student) return res.redirect('/portal');
    res.render('auth/student_login', {
        title: 'Student Portal Login',
        error: req.query.error || null,
        success: req.query.success || null
    });
};

exports.postStudentLogin = async (req, res) => {
    const { admission_number, password } = req.body;
    if (!admission_number || !password) return res.redirect('/auth/student-login?error=All fields are required');

    try {
        const student = await db.get("SELECT * FROM students WHERE admission_number = ? AND status = 'active'", [admission_number]);
        
        if (!student) {
            return res.redirect('/auth/student-login?error=Invalid admission number.');
        }

        let isMatch = false;
        // Check if password matches admission number (default)
        if (password === student.admission_number) {
            isMatch = true;
        } else if (student.password) {
            // Check if it's a hashed password
            if (student.password.startsWith('$2a$') || student.password.startsWith('$2b$')) {
                isMatch = await bcrypt.compare(password, student.password);
            } else {
                // Cleartext comparison for old passwords
                isMatch = (student.password === password);
            }
        }

        if (!isMatch) {
            return res.redirect('/auth/student-login?error=Invalid password.');
        }

        req.session.student = {
            id: student.id,
            name: `${student.first_name} ${student.last_name}`,
            admission_number: student.admission_number,
            class_id: student.current_class_id
        };

        req.session.save(() => {
            logAction(student.id, 'STUDENT_LOGIN', 'AUTH', { admission_number }, req.ip);
            res.redirect('/portal');
        });
    } catch (err) {
        console.error('Student Login Error:', err);
        res.redirect('/auth/student-login?error=System error occurred');
    }
};

exports.studentLogout = (req, res) => {
    req.session.destroy(() => {
        res.redirect('/auth/student-login?success=Logged out successfully');
    });
};
