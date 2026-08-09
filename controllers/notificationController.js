const db = require('../utils/db');

exports.getLatestNotifications = async (req, res) => {
    try {
        const userId = req.session.staff ? req.session.staff.id : (req.session.student ? req.session.student.id : null);
        const userType = req.session.staff ? 'staff' : 'student';
        const role = req.session.staff ? req.session.staff.role : 'Student';

        if (!userId) return res.json({ notifications: [], unreadCount: 0 });

        // 1. Unified Fetching
        let announcements = [];
        let assignments = [];

        // Fetch Announcements (Admin sees all; Staff/Student filtered)
        let announcementQuery = `
            SELECT id, title, type, event_date as date, created_at, 'announcement' as source_type
            FROM announcements 
            WHERE is_published = 1
        `;
        let params = [];

        if (role !== 'Admin') {
            const targetRole = role === 'Teacher' ? 'Staff' : 'Students';
            announcementQuery += ` AND (target_role = 'All' OR target_role = ?)`;
            params.push(targetRole);
        }

        announcements = await db.all(announcementQuery, params);

        // Fetch Assignments/Class Posts
        if (req.session.student) {
            const enrollRows = await db.all(`
                SELECT class_id FROM student_enrollments WHERE student_id = ?
            `, [userId]);
            const enrolledClassIds = enrollRows.map(r => r.class_id);
            if (enrolledClassIds.length > 0) {
                const placeholders = enrolledClassIds.map(() => '?').join(',');
                assignments = await db.all(`
                    SELECT id, title, post_type as type, due_date as date, created_at, 'class_post' as source_type
                    FROM class_posts WHERE class_id IN (${placeholders})
                `, enrolledClassIds);
            }
        } else if (req.session.staff && req.session.staff.role === 'Admin') {
            // Admin should NOT see assignments in notification bell as requested
            assignments = []; 
        } else if (req.session.staff) {
            // Teachers see posts for classes they are assigned to
            assignments = await db.all(`
                SELECT cp.id, cp.title, cp.post_type as type, cp.due_date as date, cp.created_at, 'class_post' as source_type
                FROM class_posts cp
                JOIN class_assignments ca ON cp.class_id = ca.class_id
                WHERE ca.staff_id = ?
            `, [userId]);
        }

        // 2. Merge and Sort
        let rawNotifications = [...announcements, ...assignments]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 15);

        // 3. Fetch read statuses
        const reads = await db.all(`
            SELECT source_id, source_type FROM notification_reads 
            WHERE user_id = ? AND user_type = ?
        `, [userId, userType]);

        const readSet = new Set(reads.map(r => `${r.source_type}_${r.source_id}`));

        // 4. Mark unread, add countdowns, and build URLs
        const now = new Date();
        let unreadCount = 0;
        
        const notifications = rawNotifications.map(n => {
            const isRead = readSet.has(`${n.source_type}_${n.id}`);
            if (!isRead) unreadCount++;

            let countdown = null;
            if ((n.type === 'Event' || n.type === 'Assignment') && n.date) {
                const targetDate = new Date(n.date);
                const diffTime = targetDate - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                const label = n.type === 'Assignment' ? 'Due' : 'Starts';

                if (diffDays > 0) {
                    countdown = `${label} in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
                } else if (diffDays === 0) {
                    countdown = `${label} tomorrow`;
                } else if (diffTime > 0) {
                    countdown = `${label} today`;
                } else {
                    countdown = n.type === 'Assignment' ? 'Overdue' : 'Event ended';
                }
            }

            // Build Target URL
            let url = '#';
            if (n.source_type === 'announcement') {
                if (n.type === 'Event') {
                    url = userType === 'student' ? '/portal/calendar' : '/calendar';
                } else {
                    url = userType === 'student' ? `/portal/announcement/${n.id}` : `/announcements/view/${n.id}`;
                }
            } else if (n.source_type === 'class_post') {
                // Assignment view for students
                if (n.type && n.type.toLowerCase() === 'assignment') {
                    url = userType === 'student' ? `/portal/assignment/${n.id}` : '#';
                } else {
                    url = userType === 'student' ? '/portal#class-board' : '/staff/board';
                }
            }

            return {
                ...n,
                isRead,
                countdown,
                url
            };
        });

        res.json({ notifications, unreadCount });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { source_id, source_type } = req.body;
        const userId = req.session.staff ? req.session.staff.id : (req.session.student ? req.session.student.id : null);
        const userType = req.session.staff ? 'staff' : 'student';

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        await db.run(`
            INSERT OR IGNORE INTO notification_reads (user_id, user_type, source_id, source_type)
            VALUES (?, ?, ?, ?)
        `, [userId, userType, source_id, source_type]);

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to mark as read' });
    }
};
