# AI Career Coach - Cloudflare Workers Application

## 📋 Project Overview

AI Career Coach is a comprehensive AI-powered career guidance application built on Cloudflare Workers. It provides personalized career coaching, resume analysis with ATS scoring, and course/certification recommendations using Workers AI and Durable Objects.

**Live Application**: https://cf-ai-careercoach.binodkarki2.workers.dev

## ✨ Features

### 1. 💬 AI Career Coaching Chat
- Interactive chat interface for career guidance
- Personalized advice on job search, career transitions, and professional development
- Conversation history maintained across sessions
- Powered by Llama 2 models via Workers AI

### 2. 📄 Resume Scanner with ATS Ranking
- Upload resume files (.txt, .pdf) or paste text directly
- **Automatic ATS Scoring** (0-100) with ranking:
  - Excellent (80-100)
  - Good (60-79)
  - Fair (40-59)
  - Needs Improvement (0-39)
- Comprehensive analysis including:
  - Strengths identification
  - Areas for improvement
  - Keyword analysis (found vs missing)
  - Formatting and structure evaluation
  - Actionable recommendations
- **PDF Export**: Download analysis report as PDF

### 3. 🎓 Course & Certification Recommendations
- Enter job title to get personalized recommendations
- AI-powered suggestions for:
  - Relevant courses (with providers)
  - Industry certifications (with issuing organizations)
  - Career progression paths
  - Skills prioritization guidance
- **PDF Export**: Download recommendations as PDF

## 🏗️ Architecture

### Components

1. **LLM Integration** ✅
   - Cloudflare Workers AI with Llama 2 models
   - Fallback support for multiple models
   - Context-aware responses

2. **Workflow / Coordination** ✅
   - Cloudflare Workers (Hono framework)
   - Three Durable Objects for state management:
     - `CareerCoachDO` - Conversation state and memory
     - `ResumeScannerDO` - Resume analysis history and ATS scoring
     - `CourseRecommendationDO` - Course recommendation history

3. **User Input** ✅
   - Modern web interface via Cloudflare Pages
   - Tab-based navigation (Chat, Resume Scanner, Course Recommendations)
   - File upload with drag-and-drop support
   - PDF parsing (client-side with pdf.js)

4. **Memory / State** ✅
   - Durable Objects for persistent storage
   - Session-based data management
   - History tracking for all features

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Cloudflare account with Workers AI enabled
- Wrangler CLI (comes with npm install)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd cf_ai_CareerCoach

# Install dependencies
npm install

# Generate TypeScript types
npm run cf-typegen
```

### Development

```bash
# Start local development server
npm run dev
```

The application will be available at `http://localhost:8787` (or the URL shown by Wrangler).

### Deployment

```bash
# Deploy to Cloudflare Workers
npm run deploy
```

**Prerequisites for Deployment:**
- Logged into Cloudflare: `npx wrangler login`
- Workers AI enabled in Cloudflare dashboard
- Durable Objects available (included with Workers)

After deployment, you'll receive a URL like `https://cf-ai-careercoach.your-subdomain.workers.dev`

## 📁 Project Structure

```
.
├── src/
│   ├── index.ts                 # Main Worker entry point with API routes
│   ├── CareerCoachDO.ts        # Durable Object for chat conversations
│   ├── ResumeScannerDO.ts      # Durable Object for resume analysis
│   └── CourseRecommendationDO.ts # Durable Object for course recommendations
├── public/
│   └── index.html              # Frontend UI (Chat, Resume Scanner, Course Recommendations)
├── wrangler.jsonc              # Cloudflare Workers configuration
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── worker-configuration.d.ts  # Auto-generated type definitions
├── README.md                   # This file
└── PROMPTS.md                  # AI prompts used in development
```

## 🔌 API Endpoints

### Chat Endpoints
- `POST /api/chat` - Send message to AI career coach
  - Body: `{ "message": "your question", "sessionId": "optional" }`
  - Returns: `{ "response": "AI response", "sessionId": "session-id" }`

- `GET /api/history/:sessionId` - Get conversation history
- `DELETE /api/history/:sessionId` - Clear conversation history

### Resume Scanner Endpoints
- `POST /api/resume/scan` - Analyze resume with ATS scoring
  - Body: `FormData` with `resume` (file) or `resumeText` (string)
  - Returns: `{ "feedback": "...", "atsScore": 85, "atsRanking": "Excellent", "strengths": [...], "improvements": [...], "keywords": {...} }`

- `GET /api/resume/history/:sessionId` - Get resume analysis history
- `GET /api/resume/analysis/:resumeId` - Get specific analysis

### Course Recommendations Endpoints
- `POST /api/courses/recommend` - Get course/certification recommendations
  - Body: `{ "jobTitle": "Software Engineer", "sessionId": "optional" }`
  - Returns: `{ "recommendations": "...", "courses": [...], "certifications": [...], "recommendationId": "..." }`

- `GET /api/courses/history/:sessionId` - Get recommendation history

## 🧪 Testing

### Quick Test Guide

1. **Chat Feature**:
   - Ask: "How do I prepare for a job interview?"
   - Verify AI responds with helpful advice

2. **Resume Scanner**:
   - Upload a resume file or paste text
   - Check ATS score and ranking
   - Review strengths and improvements
   - Test PDF export

3. **Course Recommendations**:
   - Enter a job title (e.g., "Data Analyst")
   - Review course and certification suggestions
   - Test PDF export

## 🛠️ Configuration

### Wrangler Configuration (`wrangler.jsonc`)

Key bindings:
- `AI` - Workers AI for LLM inference
- `CAREER_COACH` - Durable Object for chat
- `RESUME_SCANNER` - Durable Object for resume analysis
- `COURSE_RECOMMENDATIONS` - Durable Object for course recommendations
- `ASSETS` - Static assets (HTML, CSS, JS)

### Environment Variables

No environment variables required. All configuration is in `wrangler.jsonc`.

## 📚 Technologies Used

- **Cloudflare Workers** - Serverless runtime
- **Workers AI** - LLM inference (Llama 2 models)
- **Durable Objects** - Persistent state management
- **Hono** - Web framework
- **TypeScript** - Type-safe development
- **pdf.js** - Client-side PDF parsing
- **jsPDF** - Client-side PDF generation

## 🐛 Troubleshooting

### Common Issues

1. **"AI binding not available"**
   - Enable Workers AI in Cloudflare dashboard
   - Check your account plan (some features require paid plans)

2. **"Durable Objects error"**
   - Ensure migrations are configured in `wrangler.jsonc`
   - Run `npm run cf-typegen` to regenerate types

3. **PDF export not working**
   - Ensure jsPDF library is loaded (check browser console)
   - Try refreshing the page

4. **Deployment fails**
   - Verify you're logged in: `npx wrangler whoami`
   - Check all Durable Objects are exported in `src/index.ts`
   - Ensure migrations are properly configured

## 📝 Development Notes

- Types are auto-generated: Run `npm run cf-typegen` after changing `wrangler.jsonc`
- Durable Objects use SQLite storage (free plan compatible)
- All AI processing happens server-side via Workers AI
- PDF parsing and generation happen client-side

## 📄 License

This project is part of a Cloudflare assignment submission.

## 🙏 Acknowledgments

- Cloudflare Workers platform
- Workers AI for LLM capabilities
- Hono framework
- pdf.js and jsPDF libraries

## 📖 Additional Documentation

- [PROMPTS.md](./PROMPTS.md) - Complete list of AI prompts used during development
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Workers AI Docs](https://developers.cloudflare.com/workers-ai/)
- [Durable Objects Docs](https://developers.cloudflare.com/durable-objects/)

---

**Repository Name**: Must be prefixed with `cf_ai_` for assignment submission

**AI-Assisted Development**: All AI prompts used are documented in [PROMPTS.md](./PROMPTS.md)

**Live Application**: https://cf-ai-careercoach.binodkarki2.workers.dev
