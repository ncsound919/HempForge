# HempForge: Agentic Hemp Compliance Platform

HempForge is a robust, full-stack regulatory and scientific platform designed for the industrial hemp and cannabinoid processing sector. It leverages specialized, multi-agent AI swarms to automate compliance verification, Certificate of Analysis (COA) intake, predictive decarboxylation modeling, and ISO 17025 laboratory linkage.

## Core Features

- **Agentic Scientific Workspace:** Coordinate multiple autonomous AI agents (Knowledge, Analysis, and Reporting) working in tandem. Track their live inference status and task executions via a unified dashboard.
- **Regulatory Ledgering & ALCOA++:** Immutable, cryptographic-signed audit trails for every data mutation (COA upload, compliance shift, Metrc sync). Ensures regulatory readiness for FDA and NC Dept of Agriculture standards.
- **Predictive Decarboxylation Engine:** Simulate theoretical yield profiles (converting THCa to Δ9-THC) using Arrhenius kinetic modeling. Instantly verify if a specific thermal processing parameter will breach the 0.3% legal limit.
- **Automated Document Drafting:** Generate compliant academic journals, regulatory briefs, and clinical whitepapers dynamically using Gemini 3.5 Flash.
- **Multi-Tenant Architecture:** Secure isolation of data across multiple organizations/tenants utilizing Firebase custom claims and robust Firestore security rules.

## Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS, Lucide Icons, React Router DOM.
- **Backend:** Express.js, Firebase Admin SDK, Google GenAI SDK (@google/genai).
- **Data Persistence:** Firebase Firestore with tenant-isolated security rules.
- **Authentication:** Firebase Auth (JWT verification).

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
3. Build for production:
   ```bash
   npm run build
   ```

## Production Deployment

The `dist/server.cjs` bundle encompasses the complete Express application, serving the statically compiled React frontend and acting as the API gateway. Run `npm start` in the production environment.
