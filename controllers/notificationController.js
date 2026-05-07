const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

exports.getLatestNotifications = (req, res) => {
    try {
        const userId = req.session.user ? req.session.user.id : (req.session.student ? req.session.student.id : null);
        const userType = req.session.user ? 'staff' : 'student';
        const role = req.session.user ? req.session.user.role : 'Student';

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

        announcements = db.prepare(announcementQuery).all(params);

        // Fetch Assignments/Class Posts
        if (req.session.student) {
            const classId = req.session.student.class_id;
            if (classId) {
                assignments = db.prepare(`
                    SELECT id, title, post_type as type, due_date as date, created_at, 'class_post' as source_type
                    FROM class_posts WHERE class_id = ?
                `).all(classId);
            }
        } else if (req.session.user && req.session.user.role === 'Admin') {
            // Admin should NOT see assignments in notification bell as requested
            assignments = []; 
        } else if (req.session.user) {
            // Teachers see posts for classes they are assigned to
            assignments = db.prepare(`
                SELECT cp.id, cp.title, cp.post_type as type, cp.due_date as date, cp.created_at, 'class_post' as source_type
                FROM class_posts cp
                JOIN class_assignments ca ON cp.class_id = ca.class_id
                WHERE ca.staff_id = ?
            `).all(userId);
        }

        // 2. Merge and Sort
        let rawNotifications = [...announcements, ...assignments]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 15);

        // 3. Fetch read statuses
        const reads = db.prepare(`
            SELECT source_id, source_type FROM notification_reads 
            WHERE user_id = ? AND user_type = ?
        `).all(userId, userType);

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
                url = `/announcements/view/${n.id}`;
            } else if (n.source_type === 'class_post') {
                url = userType === 'student' ? '/portal#class-board' : '/staff/board';
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

exports.markAsRead = (req, res) => {
    try {
        const { source_id, source_type } = req.body;
        const userId = req.session.user ? req.session.user.id : (req.session.student ? req.session.student.id : null);
        const userType = req.session.user ? 'staff' : 'student';

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        db.prepare(`
            INSERT OR IGNORE INTO notification_reads (user_id, user_type, source_id, source_type)
            VALUES (?, ?, ?, ?)
        `).run(userId, userType, source_id, source_type);

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to mark as read' });
    }
};
