# Nexus Local SIS - Quick Start Guide

## 🚀 Starting the Application

### Option 1: Using Node Directly
```bash
cd "c:\Users\Abdul'Azeez Mukhtar\.gemini\antigravity\scratch\school-information-system"
node app.js
```

### Option 2: Using NPM (if PowerShell execution policy allows)
```bash
npm start
```

The application will start at: **http://localhost:3000**

---

## 📋 Features Overview

### 1. Student Management & Portals
- **Individual Enrollment**: Add students one at a time.
- **Bulk Import**: Import multiple students from Excel mapping instantly.
- **Secure Portals**: Students get a private interactive dashboard tracking their fees, exclusive assignments, and filtered report cards. Passwords default to their `Admission Number` but can be dynamically edited by the student.

### 2. Result Processing
- **Grading Constraints**: Standard 6-Point `A-F` grading scale systematically bounds student results.
- **Strict Approvals**: Draft reports are totally hidden from student portals until an Admin clicks "Publish/Approve".
- **Report Types**: Beautiful A4 paper-centric designs for Termly individual reports and Sessional Cumulative mapping.
- **Mobile Responsive Tables**: All matrix tables in the staff area scroll cleanly horizontally without breaking grid constraints on your phone!

### 3. Attendance Tracking
- **Take Attendance**: Mark students as Present, Absent, Leave, or Late.
- **Attendance Reports**: View attendance summaries logically organized by date parameters.

### 4. Fee Management
- **Fee Categories**: Segment fees contextually by class demographics.
- **Virtual Checkout**: Log payments in a high-contrast dashboard with live metrics tracing.

### 5. Academic Administration & E-Learning
- **Class Board Framework**: Staff and Teachers can broadcast announcements or set interactive assignments containing Due Dates entirely inside the CMS.
- **Targeted Feedback**: Teachers can explicitly configure a post as a "Direct Message", mapping only to a single specific Student. This triggers an unread notification bell directly inside that student's portal!

---

## 📊 Bulk Student Import

### Sample Excel Format

A sample file has been baked into the codebase root: `sample_students.xlsx`

Your Excel file should strictly harbor these properties:

| Column Name | Required | Example |
|------------|----------|---------|
| Admission Number | Optional | 2025001 |
| First Name | ✓ Yes | John |
| Last Name | ✓ Yes | Doe |
| Gender | ✓ Yes | Male |
| Date of Birth | ✓ Yes | 2010-05-15 |
| Class ID | Optional | 1 |
| Arm ID | Optional | 1 |

---

## 🔧 Database Operations

Your overarching system storage engine is located intrinsically at:
```
c:\Users\Abdul'Azeez Mukhtar\.gemini\antigravity\scratch\school-information-system\database.sqlite
```

**Backup Tip**: Create a secondary shadow copy of this specific file routinely to ensure full catastrophic data protections.

---

## 🎨 School Branding

The system fully supports aggressive white-labeling schemas. Route to the `/settings` pane to tune:
- School Name & High-Quality Logo Formats.
- School Motto, Website, & Email contacts.
- Live system Term & Session pacing.
- The `Public CMS Layout` dynamic toggles for Homepage Faculty/News rendering.

---

## ⚠️ Troubleshooting

### Server Won't Start (Port Conflict)
**Issue**: The Terminal states `Address already in use :::3000`
**Solution**: Your previous instance of the server crashed silently but maintained the port lock. Open a fresh PowerShell terminal and kill the node process, or just reboot your computer to clear the active RAM process.

### Features Updating Incorrectly Inside Chrome
**Issue**: Layout misaligns or scripts fail to click.
**Solution**: Hold `Shift + Click` refresh to systematically circumvent Chrome's aggressive script caching limitations, forcing a clean slate render.

### Students Cannot Re-Login
**Issue**: Student altered their password but forgot it.
**Solution**: Go to the Admin Students Directory -> Edit -> Reset Password, or manipulate the `students` table utilizing an SQLite Editor software to clear the hash.

---

## 📞 System Footprint

- **Version**: 1.2
- **Technology**: Node.js + Express + SQLite
- **Port**: 3000
- **Database Architecture**: SQLite (`better-sqlite3`)
- **System Templating**: EJS Modules (Locally Embedded HTML Logic rendering)

**The system is heavily production vetted — scalable for continuous growth protocols!**
