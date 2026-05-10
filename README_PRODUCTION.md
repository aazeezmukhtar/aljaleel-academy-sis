# Production Deployment Guide (Nexus Web SIS)

This copy of the School Information System is optimized for web deployment using GitHub, Vercel, and Supabase.

## 1. Database Setup (Supabase)
1. Create a new project on [Supabase](https://supabase.com/).
2. Go to **Settings > Database** and copy your **Connection String (URI)**.
3. It should look like: `postgresql://postgres:[PASSWORD]@db.[PROJECT-ID].supabase.co:5432/postgres`

## 2. GitHub Setup
1. Create a new repository on GitHub.
2. Run the following commands in this directory:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for web production"
   git branch -M main
   git remote add origin https://github.com/[YOUR-USERNAME]/[YOUR-REPO-NAME].git
   git push -u origin main
   ```

## 3. Vercel Deployment
1. Go to [Vercel](https://vercel.com/) and click **Add New > Project**.
2. Import your GitHub repository.
3. In **Environment Variables**, add the following:
   - `DATABASE_URL`: [Your Supabase Connection String]
   - `DB_TYPE`: `postgres`
   - `SESSION_SECRET`: [Any random string]
   - `PORT`: `3000`
4. Click **Deploy**.

## 4. Run Migrations
Once deployed, you need to initialize the Supabase database schema.
1. You can run the migration script locally (if you have Node.js and the `DATABASE_URL` set in a `.env` file):
   ```bash
   node migrate-postgres.js
   ```
2. Alternatively, copy the contents of `migrate-postgres.js` (the SQL string part) and run it in the **Supabase SQL Editor**.

## 5. PWA Features
- The app is already configured as a PWA.
- Once accessed over HTTPS (provided by Vercel), you will see an "Install" prompt in your browser.
- Attendance and Result entry will work offline automatically.

---
**Note**: The original offline version remains untouched in the original directory.
