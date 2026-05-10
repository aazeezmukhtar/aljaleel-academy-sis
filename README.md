# 🏫 Nexus SIS — Digital School Ecosystem

A comprehensive, offline-first **School Information System** built with a seamless public-facing school website, a robust admin Content Management System (CMS), an optimized **100% Mobile Responsive** staff dashboard, and an integrated Student E-Learning Portal.

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js |
| **Framework** | Express.js |
| **Templating** | EJS (Embedded JavaScript) |
| **Database** | SQLite (via `better-sqlite3`) |
| **Sessions** | `express-session` + `connect-sqlite3` |
| **Auth** | `bcryptjs` password hashing |
| **File Uploads** | `multer` |
| **Styling** | Vanilla CSS + Bootstrap Icons + Google Fonts |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** v18 or higher
- **npm**

### Installation

```bash
# Clone or copy the project folder
cd school-information-system

# Install dependencies
npm install

# Run the database migrations (first time setup)
node migrate.js

# Start the development server
node app.js
```

The system will be available at: **http://localhost:3000**

---

## 🌐 System Modules

### 1. Student Portal (`/portal`)
A private, isolated portal for students, deeply integrated with an E-Learning dashboard.
- **E-Learning Native**: Students receive direct assignments, class-wide announcements, and due dates dynamically sent by their teachers.
- **Strict Report Card Gates**: Report Cards (both Termly and Cumulative) only appear when the Admin enforces an **"Approved/Published"** phase, ensuring draft grades are fully hidden.
- **Responsive Grades**: Integrates the standard 6-point `A-F` grading scale.
- **Student Dashboard Options**: Payment histories, personalized notification unread badges, automated greetings, password management, and robust typography layout.

**Student Login:**
- **URL:** `/auth/student-login`
- **Username:** Admission Number.
- **Password:** Admission Number by default.

### 2. Staff / Admin Dashboard (`/dashboard`)
The primary system module for the faculty. Fully mobile responsive tables and grid components.

| Module | URL | Role Access |
|---|---|---|
| Dashboard | `/dashboard` | All Staff |
| E-Learning Board | `/staff/board`| All Staff (Teachers assign direct messages to students here) |
| Students | `/students` | All Staff |
| Results | `/results` | All Staff |
| Attendance | `/attendance` | All Staff |
| Fees | `/fees` | All Staff |
| Academics | `/academics` | Admin |
| Staff Directory | `/staff` | Admin |
| Reports | `/reports` | Admin |
| Settings | `/settings` | Admin |
| Website CMS | `/cms` | Admin |

**Staff Login:**
- **URL:** `/auth/login` (Admin/Teacher panel)
- **Password:** `[staffID]123` defaults.

### 3. Public School Website (`/`)
An interactive public website serving a dynamic CMS.
- Driven via `/news` and `/gallery` fetching active artifacts.
- "Meet Our Faculty" fetches populated profile bio configurations from the Staff Directory.

---

## 🔐 Advanced Role-Based Security

| Role | Perimeter |
|---|---|
| **Admin** | Full system configurations, staff roles tuning, report approvals, grading thresholds, CMS edits. |
| **Teacher** | Scoped access exclusively mapped to their assigned subjects and Form-Guide mapped classrooms. E-Learning authority over specific assigned students. |
| **Student** | Hard-locked to `/portal`. Impossible to route to staff domains. Can reset passwords dynamically. |

---

## ⚙️ Core Administration

Navigate to `/settings` (Admin only) to orchestrate:
- **School Infrastructure**: Apply brand colors, motto, customized logo generation recursively applying to Portals and Websites.
- **Academic Pacing**: Define Active Term and Sessions systematically regulating grade structures globally.

---

## 🛠️ Deployment Troubleshooting

| Scenario | Resolution |
|---|---|
| Port in use during `node app.js` | Close stray node tasks using `Task Manager` / `.kill` command mappings. |
| Report Cards not available on Portal | Ensure the Result Entry batch is marked `Approved` by Admin. Draft cards purposefully hide from portal views. |
| Styling / Table formatting errors | Tables are natively wrapped in `.table-responsive` styling guaranteeing fluid mobile swiping horizontal dimensions. |

---

## 📄 License
Proprietary — Al-Jaleel Academy. Internal system distributions only.
