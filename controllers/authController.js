const db = require('../utils/db');
const bcrypt = require('bcryptjs');
const { logAction } = require('../utils/logger');

exports.getLogin = (req, res) => {
    // If already logged in, redirect to dashboard
    if (req.session.staff) {
        return res.redirect('/dashboard');
    }
    res.render('auth/login', {
        title: 'Staff Login ΓÇö AcadMe',
        error: req.query.error || null
    });
};

exports.postLogin = async (req, res) => {
    const { staff_id, password } = req.body;

    if (!staff_id || !password) {
        return res.redirect('/auth/login?error=All fields are required');
    }

    try {
        // Authenticate staff record by unique identifier and active status
        const staff = await db.get(
            "SELECT * FROM staff WHERE LOWER(staff_id) = LOWER(?) AND status = 'active'",
            [String(staff_id).trim()]
        );

        if (!staff || !staff.school_id) {
            return res.redirect('/auth/login?error=Invalid Staff ID or account inactive');
        }

        const isMatch = await bcrypt.compare(password, staff.password_hash);

        if (!isMatch) {
            return res.redirect('/auth/login?error=Invalid Password');
        }

        const authoritativeSchoolId = Number(staff.school_id);

        // Create session strictly with authoritative database-derived school_id
        req.session.staff = {
            id: staff.id,
            staff_id: staff.staff_id,
            name: `${staff.first_name} ${staff.last_name}`,
            first_name: staff.first_name,
            last_name: staff.last_name,
            role: staff.role,
            school_id: authoritativeSchoolId
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
    const schoolId = user ? Number(user.school_id) : (req.schoolId || 1);

    if (new_password !== confirm_password) {
        return res.redirect('/auth/change-password?error=Passwords do not match');
    }

    try {
        const staff = await db.get(
            'SELECT * FROM staff WHERE id = ? AND school_id = ?',
            [user.id, schoolId]
        );
        if (!staff) {
            return res.redirect('/auth/login?error=Session invalid');
        }

        const isMatch = await bcrypt.compare(current_password, staff.password_hash);

        if (!isMatch) {
            return res.redirect('/auth/change-password?error=Incorrect current password');
        }

        const hashed = await bcrypt.hash(new_password, 10);
        await db.run(
            'UPDATE staff SET password_hash = ? WHERE id = ? AND school_id = ?',
            [hashed, user.id, schoolId]
        );

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
        title: 'Student Portal ΓÇö AcadMe',
        error: req.query.error || null,
        success: req.query.success || null
    });
};

exports.postStudentLogin = async (req, res) => {
    const { admission_number, password } = req.body;

    // Guard: both fields must be present
    if (!admission_number || !password) {
        return res.redirect('/auth/student-login?error=Please enter your Student ID and password.');
    }

    try {
        const student = await db.get(
            "SELECT * FROM students WHERE admission_number = ? AND status = 'active'",
            [String(admission_number).trim()]
        );

        if (!student || !student.school_id) {
            return res.redirect('/auth/student-login?error=Student ID or password is incorrect.');
        }

        let isMatch = false;
        // Check if password matches admission number (default first-login password)
        if (password === student.admission_number) {
            isMatch = true;
        } else if (student.password) {
            // Check if it's a bcrypt hash
            if (student.password.startsWith('$2a$') || student.password.startsWith('$2b$')) {
                isMatch = await bcrypt.compare(password, student.password);
            } else {
                // Cleartext comparison for legacy passwords
                isMatch = (student.password === password);
            }
        }

        if (!isMatch) {
            return res.redirect('/auth/student-login?error=Student ID or password is incorrect.');
        }

        const authoritativeSchoolId = Number(student.school_id);

        req.session.student = {
            id: student.id,
            name: `${student.first_name} ${student.last_name}`,
            admission_number: student.admission_number,
            class_id: student.current_class_id,
            school_id: authoritativeSchoolId
        };

        req.session.save(() => {
            logAction(student.id, 'STUDENT_LOGIN', 'AUTH', { admission_number }, req.ip);
            res.redirect('/portal');
        });
    } catch (err) {
        console.error('Student Login Error:', err);
        res.redirect('/auth/student-login?error=A system error occurred. Please try again.');
    }
};

exports.studentLogout = (req, res) => {
    req.session.destroy(() => {
        res.redirect('/auth/student-login?success=Logged out successfully');
    });
};

