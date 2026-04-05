# AccessDesk - AI powered IT self-service portal

## Demo

[Watch the video](https://www.youtube.com/watch?v=XM2j-hruy2k)



AI-powered IT self-service portal that automates software access provisioning. Built with Node.js, Express, and Amazon Bedrock (Claude), it features an access agent that auto-grants or escalates requests based on job-level policies, an LLM chat assistant for natural language tool discovery and employee lookups, a rules engine with configurable per-tool approval chains, secure token-based approval workflows with email notifications, dual portals (employee self-service + manager approval dashboard), real-time request lifecycle tracking, and a DynamoDB-backed data layer with CDK infrastructure for production deployment on AWS.

## AI Components

### 1. Access Agent (`access-agent.js`)
The decision engine. When an employee requests software, the agent checks the rules and either grants access or escalates:
- **Auto-grant**: If the employee's job level matches the tool's eligibility list, the agent approves and provisions access instantly - no human in the loop
- **Escalate**: If the employee isn't eligible or the tool always requires approval, the agent generates a secure token, records the decision reason, and triggers a notification to the designated approver

Every decision includes a human-readable explanation (e.g., "Job level 'intern' not eligible for auto-grant of Camtasia").

### 2. LLM Chat Assistant (`/api/chat` + `llm.js`)
A conversational interface on both portals powered by Amazon Bedrock (Claude). The chat endpoint sends the full software catalog, employee profile, pending requests, and employee lookup results as context to Claude, which generates natural language responses.

**Requires**: AWS credentials with Bedrock access (`aws configure` or env vars). Model: `anthropic.claude-3-haiku-20240307-v1:0` (configurable via `BEDROCK_MODEL_ID` env var).

**For employees:**
- Tool discovery - "I need to record my screen" → Claude recommends Camtasia with context about eligibility
- Availability check - "What tools can I install?" → Claude lists tools based on the employee's job level
- Status check - "What approvals are pending?" → Claude reports pending requests with approver names

**For managers:**
- Employee lookup by name - "Who is Princy?" → Claude returns job level, department, email, software cost
- Contextual answers - "Should I approve this Camtasia request for an intern?" → Claude reasons about policy

### 3. Rules Engine (`rules-engine.js`)
Deterministic policy evaluation:
- Checks `requiresApprovalAlways` flag first (e.g., Adobe Creative Cloud always needs human review)
- Checks employee job level against the tool's `autoGrantJobLevels` list
- Returns a structured decision with reason, approver ID, and approver name

### LLM Configuration
The chat assistant requires AWS credentials with Amazon Bedrock access. Set up with `aws configure` or environment variables:
- `AWS_REGION` - default: `us-east-1`
- `BEDROCK_MODEL_ID` - default: `anthropic.claude-3-haiku-20240307-v1:0`

## Features

**Employee Portal** - Software catalog with categories, search, real product icons. Install button for eligible tools, Request Approval for others. Pending requests show "Requested" with approver name. History view. AI chat.

**Manager Portal** - Pending approvals queue showing requester name, job level, reason. Approve/reject with reason modal. Resolved requests view. AI chat for employee lookups by name.

**Security** - Approval tokens are 32-byte cryptographically random hex strings with 72-hour expiry. DynamoDB conditional updates prevent concurrent approve/reject race conditions. Status transitions are validated (no skipping steps).

**Email Notifications** - In production, sends approval emails via Amazon SES with tokenized approve/reject links. Locally, email events are logged to the console.

**Persistence** - Local dev uses in-memory store with JSON file persistence (survives restarts). Production option uses DynamoDB.

