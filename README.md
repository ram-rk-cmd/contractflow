# 🏗️ ContractFlow — Construction Fund Manager

## Local Setup
1. Install Node.js from nodejs.org
2. Open MySQL Workbench, run `schema.sql`
3. Copy `.env.example` to `.env`, fill in your MySQL password and set your PINs
4. Open terminal in this folder: `npm install` then `node server.js`
5. Open browser: http://localhost:3000

## Railway Deployment
1. Create account at railway.app
2. New Project → Deploy from GitHub repo (push this folder to GitHub first)
3. Add a MySQL service to the project
4. Copy MySQL connection variables to your Node service environment
5. Add OWNER_PIN, ASSISTANT_PIN, TOKEN_SECRET to environment variables
6. Connect to Railway MySQL and run schema.sql
7. Deploy → Railway gives you a public URL

## Default PINs
- Owner: 1234
- Assistant: 5678
(Change these in .env before deploying!)

## Usage
- **Owner**: Use Owner PIN to access full dashboard
- **Assistant**: Use Assistant PIN — can only add expenses for a selected site
