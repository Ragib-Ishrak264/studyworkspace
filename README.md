# Workspace Hub

A modern, cloud & offline-first personal workspace dashboard for organizing files, PDFs, links, bookmarks, and notes in an intuitive multi-workspace environment with real-time multi-device sync.

## Features

- ☁️ **Supabase Cloud Database & Authentication**: Real-time multi-device sync (phone, laptop, tablet, desktop) using PostgreSQL and Supabase Auth.
- 🔐 **Cross-Device Login**: Sign in with Email/Password, Magic Link, or Google OAuth from anywhere in the world.
- 📁 **Cloud & Local Storage**: Upload PDFs and documents directly to Supabase Storage with global fast delivery.
- ⚡ **Real-Time Live Updates**: Instant websocket synchronization across all open devices when items or categories are modified.
- 🗂️ **Multi-Workspace Support**: Create distinct workspaces (e.g. Courses, Research, Personal) with strict Row Level Security (RLS) data isolation.
- 🗃️ **Folder Management & Explorer**: Nested folder hierarchy, drag-and-drop file organization, breadcrumb navigation, and status badges.
- 🖱️ **Right-Click Context Menu**: Instant access to Info & History, Copy Link/Path, Download, Rename, Move, and Delete.
- 🔄 **1-Click Local to Cloud Migration**: Migrate your existing local items directly into Supabase Cloud Database.

---

## 🚀 Setting Up Supabase (Cloud Database & Auth)

1. **Create a Free Supabase Project**:
   - Go to [supabase.com](https://supabase.com) and create a free project.

2. **Run the Database Schema**:
   - In your Supabase Project Dashboard, go to **SQL Editor**.
   - Open [`supabase-schema.sql`](file:///d:/Satu/workspace/supabase-schema.sql) from this repository, copy all contents, and click **Run**.
   - This creates all required tables (`profiles`, `workspaces`, `categories`, `folders`, `items`), storage buckets, and security policies (RLS).

3. **Configure Project URL & Anon Key**:
   - **Option A (In Web App)**: Click the **Supabase Cloud** button in the header of the app, paste your **Project URL** and **Anon Public Key**, and click **Save & Connect**.
   - **Option B (In `.env` file)**:
     ```env
     SUPABASE_URL=https://your-project.supabase.co
     SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
     ```

4. **Sign In & Sync**:
   - Click **Sign In** / **Create Account** to create your account. You can now log into your workspace from any phone, laptop, or browser!

---

## Getting Started Locally

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or newer)

### Installation & Run

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the application:
   - On Windows: Double-click `start.bat` or run:
     ```bash
     npm start
     ```
3. Open [http://localhost:3000](http://localhost:3000) in your web browser.

