# HomeQuote Link

HomeQuote Link is a modern lead-generation and routing platform that connects homeowners with local service providers (plumbers, HVAC technicians, landscapers, electricians, etc.).

## Architecture & Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Shadcn UI
- **Backend & Database**: Supabase (Postgres)
- **Hosting & Deployment**: Vercel (integrated with the GitHub repository)
- **State Management**: TanStack React Query

## Getting Started

### Local Development

1. **Clone the repository**:
   ```bash
   git clone <YOUR_GIT_URL>
   cd HomeQuoteLink
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up Environment Variables**:
   Configure your local environment variables in a `.env` file at the root of the project. Replace the placeholders with your actual Supabase credentials:
   ```env
   VITE_SUPABASE_URL="https://<YOUR_NEW_PROJECT_REF>.supabase.co"
   VITE_SUPABASE_PUBLISHABLE_KEY="<YOUR_NEW_PUBLISHABLE_ANON_KEY>"
   VITE_SUPABASE_PROJECT_ID="<YOUR_NEW_PROJECT_REF>"
   ```

4. **Link to your Supabase Project**:
   To manage database migrations, functions, or schemas, link the local project config to your new Supabase project reference:
   ```bash
   npx supabase link --project-ref <YOUR_NEW_PROJECT_REF>
   ```

5. **Start the local dev server**:
   ```bash
   npm run dev
   ```

## Deployment

Deployments are automated through **Vercel** via GitHub integration. Any push or merge to the `main` branch will trigger an automatic production build on Vercel.

Make sure to configure the following environment variables in your Vercel project settings:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (use your `VITE_SUPABASE_PUBLISHABLE_KEY` value)
- `VITE_SUPABASE_PROJECT_ID`
